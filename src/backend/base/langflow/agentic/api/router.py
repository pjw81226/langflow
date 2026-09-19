"""Langflow Assistant API router.

The assistant has three tabs (Component, Prompt, Ask) and a Test flow button,
all served by ``/assist/stream``. Business logic lives in the service modules;
this router checks access, resolves the model, snapshots the canvas and hands
the turn to ``stream_assistant_turn``.
"""

import copy
from collections.abc import AsyncIterator
from dataclasses import dataclass
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from lfx.base.models.unified_models import (
    get_all_variables_for_provider,
    get_provider_required_variable_keys,
    get_provider_secret_variable_key,
    get_unified_models_detailed,
    is_known_model_provider,
)
from lfx.log.logger import logger
from lfx.services.deps import get_settings_service
from lfx.services.model_provider_policy import ModelProviderPolicyPurpose
from sqlalchemy.ext.asyncio import AsyncSession

from langflow.agentic.api.deps import require_agentic_experience
from langflow.agentic.api.schemas import AssistantRequest
from langflow.agentic.services.assistant_turn import stream_assistant_turn
from langflow.agentic.services.conversation_history import normalize_session_id
from langflow.agentic.services.provider_service import (
    PREFERRED_PROVIDERS,
    build_live_only_provider_entries,
    get_default_model,
    get_enabled_providers_for_user,
    list_installed_tool_calling_models,
)
from langflow.api.utils.core import CurrentActiveUser, DbSession, release_db_transaction
from langflow.services.authorization.access_ceiling import (
    external_access_allows,
    get_current_external_access_context,
)
from langflow.services.model_provider_policy_scope import scoped_model_provider_policy_for_flow

router = APIRouter(prefix="/agentic", tags=["Agentic"], include_in_schema=False)


@dataclass(frozen=True)
class _AssistantContext:
    """Resolved provider, model, and execution context for assistant endpoints."""

    provider: str
    model_name: str
    api_key_name: str | None
    session_id: str
    global_vars: dict[str, str]


def _configured_ask_model() -> tuple[str | None, str | None]:
    """``(provider, model)`` from ``LANGFLOW_ASSISTANT_ASK_MODEL``, or ``(None, None)``.

    The value is ``Provider:model``. Only the first colon separates the two, because
    model names carry colons of their own (``llama3.1:8b``).
    """
    from lfx.services.deps import get_settings_service

    configured = (getattr(get_settings_service().settings, "assistant_ask_model", "") or "").strip()
    provider, separator, model = configured.partition(":")
    if not separator or not provider.strip() or not model.strip():
        if configured:
            logger.warning("assistant.ask_model.malformed value=%r; expected Provider:model", configured)
        return None, None
    return provider.strip(), model.strip()


async def _resolve_assistant_context(
    request: AssistantRequest,
    user_id: UUID,
    session: AsyncSession,
) -> _AssistantContext:
    """Resolve provider, model, API key, and build execution context.

    Raises:
        HTTPException: If provider is not configured or API key is missing.
    """
    enabled_providers, _ = await get_enabled_providers_for_user(
        user_id,
        session,
        purpose=ModelProviderPolicyPurpose.USE,
    )

    if not enabled_providers:
        raise HTTPException(
            status_code=400,
            detail="No model provider is configured. Please configure at least one model provider in Settings.",
        )

    provider = request.provider
    requested_model = request.model_name
    if request.mode == "ask":
        ask_provider, ask_model = _configured_ask_model()
        if ask_provider and ask_provider in enabled_providers:
            provider, requested_model = ask_provider, ask_model
        elif ask_provider:
            # Never a 400: the question still gets answered, with the panel's model.
            logger.warning(
                "assistant.ask_model.provider_not_enabled provider=%s; using the requested model", ask_provider
            )
    if not provider:
        for preferred in PREFERRED_PROVIDERS:
            if preferred in enabled_providers:
                provider = preferred
                break
        if not provider:
            provider = enabled_providers[0]

    if provider not in enabled_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Provider '{provider}' is not configured. Available providers: {enabled_providers}",
        )

    # A provider configured by connection settings alone (Ollama's base URL, a local
    # OpenAI-compatible server) declares no secret, so an absent key name is expected
    # and says nothing about recognition. Only a name the model catalog does not know
    # is genuinely unknown here.
    api_key_name = get_provider_secret_variable_key(provider)
    if not api_key_name and not is_known_model_provider(provider):
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    model_name = requested_model or get_default_model(provider, user_id=user_id) or ""

    # Get all configured variables for the provider
    provider_vars = get_all_variables_for_provider(user_id, provider)

    # Validate all required variables are present
    required_keys = get_provider_required_variable_keys(provider)
    missing_keys = [key for key in required_keys if not provider_vars.get(key)]

    if missing_keys:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Missing required configuration for {provider}: {', '.join(missing_keys)}. "
                "Please configure these in Settings > Model Providers."
            ),
        )

    global_vars: dict[str, str] = {
        "USER_ID": str(user_id),
        "FLOW_ID": request.flow_id,
        "MODEL_NAME": model_name,
        "PROVIDER": provider,
    }

    # Inject all provider variables into the global context
    global_vars.update(provider_vars)

    return _AssistantContext(
        provider=provider,
        model_name=model_name,
        api_key_name=api_key_name,
        # The agents store their replies under the user's flow; the prefix keeps
        # these sessions out of the Playground.
        session_id=normalize_session_id(request.session_id),
        global_vars=global_vars,
    )


async def _validate_flow_access(flow_id: str | None, user_id: UUID, session: AsyncSession):
    """Reject an unknown or not-owned flow_id before the model is invoked.

    A missing flow_id is allowed (the assistant runs with no canvas context).
    A supplied id must reference a flow the caller can access, mirroring the
    per-user 404 of the /run and webhook endpoints; not-found and cross-user
    both surface 404 so a flow's existence is not leaked by id.
    """
    if flow_id is None:
        return None

    from langflow.services.database.models.flow import Flow

    try:
        flow_uuid = UUID(flow_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid flow_id: not a valid UUID.") from exc

    flow = await session.get(Flow, flow_uuid)
    if flow is None or (flow.user_id is not None and str(flow.user_id) != str(user_id)):
        raise HTTPException(status_code=404, detail="Flow not found.")
    return flow


@router.get("/check-config")
async def check_assistant_config(
    current_user: CurrentActiveUser,
    session: DbSession,
) -> dict:
    """Check if the Langflow Assistant is properly configured.

    Returns available providers with their configured status and available models, plus
    ``enabled``: whether ``agentic_experience`` gates the assistant off. Provider config and
    the feature gate are independent failure modes -- without ``enabled`` a caller cannot tell
    "no provider connected" from "feature disabled", and every /assist call 404s with no way
    to explain why. This probe stays ungated so that distinction survives the gate.
    """
    user_id = current_user.id
    enabled = get_settings_service().settings.agentic_experience
    enabled_providers, _ = await get_enabled_providers_for_user(
        user_id,
        session,
        purpose=ModelProviderPolicyPurpose.CONFIGURE,
    )

    all_providers = []

    if enabled_providers:
        models_by_provider = get_unified_models_detailed(
            providers=enabled_providers,
            include_unsupported=False,
            include_deprecated=False,
            model_type="llm",
        )
        for provider_dict in models_by_provider:
            provider_name = provider_dict.get("provider")
            if not provider_name:
                continue
            installed = list_installed_tool_calling_models(provider_name, user_id)
            if installed:
                provider_dict["models"] = [{"model_name": name, "metadata": {}} for name in installed]
            models = provider_dict.get("models", [])

            model_list = []
            for model in models:
                model_name = model.get("model_name")
                display_name = model.get("display_name", model_name)
                metadata = model.get("metadata", {})

                is_deprecated = metadata.get("deprecated", False)
                is_not_supported = metadata.get("not_supported", False)

                if not is_deprecated and not is_not_supported:
                    model_list.append(
                        {
                            "name": model_name,
                            "display_name": display_name,
                        }
                    )

            default_model = get_default_model(provider_name)
            if model_list and default_model not in {m["name"] for m in model_list}:
                default_model = model_list[0]["name"]

            if model_list:
                all_providers.append(
                    {
                        "name": provider_name,
                        "configured": True,
                        "default_model": default_model,
                        "models": model_list,
                    }
                )

    # Live providers with an all-deprecated static catalog (e.g. IBM WatsonX) are dropped above
    # before their live fetch runs; re-add them from live tool-calling models.
    if enabled_providers:
        all_providers.extend(
            build_live_only_provider_entries(
                enabled_providers,
                {p["name"] for p in all_providers},
                user_id,
            )
        )

    default_provider = None
    default_model = None

    providers_with_models = [p["name"] for p in all_providers]

    for preferred in PREFERRED_PROVIDERS:
        if preferred in providers_with_models:
            default_provider = preferred
            for p in all_providers:
                if p["name"] == preferred:
                    default_model = p["default_model"]
                    break
            break

    if not default_provider and all_providers:
        default_provider = all_providers[0]["name"]
        default_model = all_providers[0]["default_model"]

    return {
        "enabled": enabled,
        "configured": len(enabled_providers) > 0,
        "configured_providers": enabled_providers,
        "providers": all_providers,
        "default_provider": default_provider,
        "default_model": default_model,
    }


def _require_component_creation_allowed(user) -> None:
    """Refuse a Component turn the user could never add to the canvas.

    Mirrors ``POST /api/v1/custom_component``, the route the panel's Add to canvas
    button calls: without this, a user could get a component that passed every
    check and then have it refused with 403 when adding it.
    """
    external_context = get_current_external_access_context()
    if external_context is not None and not external_access_allows("create", external_context):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="External credentials do not allow this action"
        )
    settings = get_settings_service().settings
    if not settings.allow_custom_components:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Custom component creation is disabled on this server."
        )
    if settings.custom_component_admin_only and not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Custom component creation is restricted to administrators.",
        )


def _canvas_snapshot(flow) -> dict | None:
    """A copy of the saved flow for the turn to read.

    Taken before the request transaction is released: committing expires the ORM
    object's attributes, and the turn runs long after that.
    """
    if flow is None or not flow.data:
        return None
    return {"name": flow.name, "data": copy.deepcopy(flow.data)}


@router.post("/assist/stream", dependencies=[Depends(require_agentic_experience)])
async def assist_stream(
    request: AssistantRequest,
    http_request: Request,
    current_user: CurrentActiveUser,
    session: DbSession,
) -> StreamingResponse:
    """Run one assistant turn (Component, Prompt, Ask or Test flow) with streaming progress."""
    if request.mode == "component" and request.action is None:
        _require_component_creation_allowed(current_user)
    flow = await _validate_flow_access(request.flow_id, current_user.id, session)
    with scoped_model_provider_policy_for_flow(
        flow,
        user_id=current_user.id,
        is_superuser=bool(current_user.is_superuser),
    ):
        ctx = await _resolve_assistant_context(request, current_user.id, session)
    canvas = _canvas_snapshot(flow)

    # Dependency teardown only runs after the SSE stream finishes, so without
    # this commit the request transaction (and its pooled connection) would
    # stay open for the assistant's whole streaming run (#14445).
    await release_db_transaction(session)

    async def _scoped_stream() -> AsyncIterator[str]:
        with scoped_model_provider_policy_for_flow(
            flow,
            user_id=current_user.id,
            is_superuser=bool(current_user.is_superuser),
        ):
            async for event in stream_assistant_turn(
                request,
                canvas=canvas,
                flow_id=request.flow_id,
                user_id=str(current_user.id),
                session_id=ctx.session_id,
                provider=ctx.provider,
                model_name=ctx.model_name,
                api_key_var=ctx.api_key_name,
                global_variables=ctx.global_vars,
                is_superuser=bool(current_user.is_superuser),
                is_disconnected=http_request.is_disconnected,
            ):
                yield event

    return StreamingResponse(
        _scoped_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )

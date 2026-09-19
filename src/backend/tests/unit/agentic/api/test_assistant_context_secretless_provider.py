"""A provider that declares no secret must still resolve an assistant context.

Ollama configures itself with a base URL and no API key, so
``get_provider_secret_variable_key`` legitimately returns ``None`` for it.
Treating that ``None`` as an unrecognized provider made every assistant turn
fail with "Unknown provider: Ollama" while Settings still showed Ollama
connected with its models listed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from langflow.agentic.api.router import _resolve_assistant_context
from langflow.agentic.api.schemas import AssistantRequest

_ROUTER = "langflow.agentic.api.router"


def _request(**overrides) -> AssistantRequest:
    payload = {"flow_id": str(uuid4()), "input_value": "build me a flow", **overrides}
    return AssistantRequest(**payload)


@pytest.fixture
def _ollama_only_env():
    """Ollama enabled and configured, with the real provider metadata in play."""
    with (
        patch(
            f"{_ROUTER}.get_enabled_providers_for_user",
            new_callable=AsyncMock,
            return_value=(["Ollama"], {"Ollama": True}),
        ),
        patch(f"{_ROUTER}.get_default_model", return_value="llama3.2:latest"),
        patch(
            f"{_ROUTER}.get_all_variables_for_provider",
            return_value={"OLLAMA_BASE_URL": "http://localhost:11434"},
        ),
    ):
        yield


@pytest.mark.usefixtures("_ollama_only_env")
async def test_explicit_ollama_provider_resolves_context():
    ctx = await _resolve_assistant_context(
        _request(provider="Ollama", model_name="llama3.2:latest"),
        uuid4(),
        session=AsyncMock(),
    )

    assert ctx.provider == "Ollama"
    assert ctx.api_key_name is None
    assert ctx.global_vars["MODEL_NAME"] == "llama3.2:latest"
    assert ctx.global_vars["OLLAMA_BASE_URL"] == "http://localhost:11434"


@pytest.mark.usefixtures("_ollama_only_env")
async def test_ollama_as_sole_provider_resolves_without_explicit_selection():
    """No provider in the request: falling back to the only enabled one must work."""
    ctx = await _resolve_assistant_context(_request(), uuid4(), session=AsyncMock())

    assert ctx.provider == "Ollama"
    assert ctx.global_vars["PROVIDER"] == "Ollama"


async def test_genuinely_unknown_provider_is_still_rejected():
    """The guard must keep rejecting a provider the model catalog does not know.

    Pins the guard, not a reachable production path: enabled providers are built
    from the catalog, so anything that clears the enablement check above already
    satisfies recognition. Reaching this branch takes a mocked enablement result
    that enablement itself could never produce. Kept as defense in depth.
    """
    with (
        patch(
            f"{_ROUTER}.get_enabled_providers_for_user",
            new_callable=AsyncMock,
            return_value=(["NotAProvider"], {"NotAProvider": True}),
        ),
        patch(f"{_ROUTER}.get_default_model", return_value="some-model"),
        patch(f"{_ROUTER}.get_all_variables_for_provider", return_value={}),
        pytest.raises(HTTPException) as exc_info,
    ):
        await _resolve_assistant_context(
            _request(provider="NotAProvider"),
            uuid4(),
            session=AsyncMock(),
        )

    assert exc_info.value.status_code == 400
    assert "Unknown provider" in str(exc_info.value.detail)


async def test_credentialless_extension_provider_resolves_without_api_key_name():
    with (
        patch(
            f"{_ROUTER}.get_enabled_providers_for_user",
            new_callable=AsyncMock,
            return_value=(["AmbientAuthCo"], {"AmbientAuthCo": True}),
        ),
        patch(f"{_ROUTER}.get_provider_secret_variable_key", return_value=None),
        patch(f"{_ROUTER}.is_known_model_provider", return_value=True),
        patch(f"{_ROUTER}.get_default_model", return_value="ambient-chat"),
        patch(f"{_ROUTER}.get_all_variables_for_provider", return_value={}),
        patch(f"{_ROUTER}.get_provider_required_variable_keys", return_value=[]),
    ):
        ctx = await _resolve_assistant_context(
            _request(provider="AmbientAuthCo"),
            uuid4(),
            session=AsyncMock(),
        )

    assert ctx.provider == "AmbientAuthCo"
    assert ctx.api_key_name is None
    assert ctx.global_vars["MODEL_NAME"] == "ambient-chat"


async def test_base_url_only_provider_does_not_inject_connection_config_as_api_key():
    with (
        patch(
            f"{_ROUTER}.get_enabled_providers_for_user",
            new_callable=AsyncMock,
            return_value=(["LocalCo"], {"LocalCo": True}),
        ),
        patch(f"{_ROUTER}.get_provider_secret_variable_key", return_value=None),
        patch(f"{_ROUTER}.is_known_model_provider", return_value=True),
        patch(f"{_ROUTER}.get_default_model", return_value="local-chat"),
        patch(f"{_ROUTER}.get_all_variables_for_provider", return_value={"LOCALCO_BASE_URL": "http://local"}),
        patch(f"{_ROUTER}.get_provider_required_variable_keys", return_value=["LOCALCO_BASE_URL"]),
    ):
        ctx = await _resolve_assistant_context(
            _request(provider="LocalCo"),
            uuid4(),
            session=AsyncMock(),
        )

    assert ctx.api_key_name is None
    assert ctx.global_vars["LOCALCO_BASE_URL"] == "http://local"

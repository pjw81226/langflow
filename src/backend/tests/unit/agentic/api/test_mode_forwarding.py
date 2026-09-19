"""The panel mode on the request must reach the assistant service on both endpoints."""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from langflow.agentic.api import router as assistant_router
from langflow.agentic.api.schemas import AssistantRequest

_ROUTER = "langflow.agentic.api.router"


def _request(**overrides) -> AssistantRequest:
    payload = {"flow_id": str(uuid4()), "input_value": "How do I test a flow?", **overrides}
    return AssistantRequest(**payload)


@contextmanager
def _no_policy_scope(*_args, **_kwargs):
    yield


def _context() -> SimpleNamespace:
    return SimpleNamespace(
        provider="OpenAI",
        model_name="gpt-test",
        api_key_name="OPENAI_API_KEY",
        session_id="session-1",
        global_vars={},
        max_retries=1,
    )


@pytest.fixture
def _endpoint_env():
    with (
        patch(f"{_ROUTER}._validate_flow_access", new_callable=AsyncMock, return_value=SimpleNamespace(id=uuid4())),
        patch(f"{_ROUTER}.scoped_model_provider_policy_for_flow", _no_policy_scope),
        patch(f"{_ROUTER}._resolve_assistant_context", new_callable=AsyncMock, return_value=_context()),
        patch(f"{_ROUTER}.release_db_transaction", new_callable=AsyncMock),
    ):
        yield


def _user() -> SimpleNamespace:
    return SimpleNamespace(id=uuid4(), is_superuser=False)


@pytest.mark.usefixtures("_endpoint_env")
@pytest.mark.parametrize("mode", ["ask", "build", None])
async def test_assist_forwards_the_mode(mode):
    service = AsyncMock(return_value={"result": "ok"})
    with patch(f"{_ROUTER}.execute_flow_with_validation", service):
        await assistant_router.assist(_request(mode=mode), _user(), AsyncMock())

    assert service.await_args.kwargs["mode"] == mode


@pytest.mark.usefixtures("_endpoint_env")
@pytest.mark.parametrize("mode", ["ask", "build", None])
async def test_assist_stream_forwards_the_mode(mode):
    captured: dict = {}

    async def fake_stream(**kwargs):
        captured.update(kwargs)
        yield "data: {}\n\n"

    http_request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
    with patch(f"{_ROUTER}.execute_flow_with_validation_streaming", fake_stream):
        response = await assistant_router.assist_stream(_request(mode=mode), http_request, _user(), AsyncMock())
        async for _chunk in response.body_iterator:
            pass

    assert captured["mode"] == mode


@pytest.mark.usefixtures("_endpoint_env")
@pytest.mark.parametrize("action", ["test_flow", None])
async def test_assist_stream_forwards_the_action(action):
    captured: dict = {}

    async def fake_stream(**kwargs):
        captured.update(kwargs)
        yield "data: {}\n\n"

    http_request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
    with patch(f"{_ROUTER}.execute_flow_with_validation_streaming", fake_stream):
        response = await assistant_router.assist_stream(_request(action=action), http_request, _user(), AsyncMock())
        async for _chunk in response.body_iterator:
            pass

    assert captured["action"] == action


class TestAskModel:
    """A deployment can point Ask turns at a cheaper model than the one that builds flows."""

    @pytest.fixture
    def _provider_env(self):
        with (
            patch(
                f"{_ROUTER}.get_enabled_providers_for_user",
                new_callable=AsyncMock,
                return_value=(["OpenAI"], {}),
            ),
            patch(f"{_ROUTER}.get_provider_secret_variable_key", return_value="OPENAI_API_KEY"),
            patch(f"{_ROUTER}.get_default_model", return_value="gpt-default"),
            patch(f"{_ROUTER}.get_all_variables_for_provider", return_value={"OPENAI_API_KEY": "sk-test"}),
            patch(f"{_ROUTER}.get_provider_required_variable_keys", return_value=["OPENAI_API_KEY"]),
        ):
            yield

    @staticmethod
    def _configure(monkeypatch, value: str) -> None:
        from lfx.services.deps import get_settings_service

        monkeypatch.setattr(get_settings_service().settings, "assistant_ask_model", value)

    @pytest.mark.usefixtures("_provider_env")
    async def test_an_ask_turn_uses_the_configured_ask_model(self, monkeypatch):
        self._configure(monkeypatch, "OpenAI:gpt-small")

        ctx = await assistant_router._resolve_assistant_context(
            _request(mode="ask", provider="OpenAI", model_name="gpt-big"), uuid4(), session=AsyncMock()
        )

        assert (ctx.provider, ctx.model_name) == ("OpenAI", "gpt-small")
        assert ctx.global_vars["MODEL_NAME"] == "gpt-small"

    @pytest.mark.usefixtures("_provider_env")
    @pytest.mark.parametrize("mode", ["build", None])
    async def test_other_turns_keep_the_model_picked_in_the_panel(self, monkeypatch, mode):
        self._configure(monkeypatch, "OpenAI:gpt-small")

        ctx = await assistant_router._resolve_assistant_context(
            _request(mode=mode, provider="OpenAI", model_name="gpt-big"), uuid4(), session=AsyncMock()
        )

        assert ctx.model_name == "gpt-big"

    @pytest.mark.usefixtures("_provider_env")
    async def test_an_ask_model_on_a_provider_that_is_not_configured_is_ignored(self, monkeypatch):
        """The question still gets answered, with the model the panel sent."""
        self._configure(monkeypatch, "Anthropic:claude-small")

        ctx = await assistant_router._resolve_assistant_context(
            _request(mode="ask", provider="OpenAI", model_name="gpt-big"), uuid4(), session=AsyncMock()
        )

        assert (ctx.provider, ctx.model_name) == ("OpenAI", "gpt-big")

    @pytest.mark.usefixtures("_provider_env")
    async def test_a_model_name_with_a_colon_of_its_own_is_kept_whole(self, monkeypatch):
        with patch(f"{_ROUTER}.get_enabled_providers_for_user", new_callable=AsyncMock, return_value=(["Ollama"], {})):
            self._configure(monkeypatch, "Ollama:llama3.1:8b")

            ctx = await assistant_router._resolve_assistant_context(_request(mode="ask"), uuid4(), session=AsyncMock())

        assert (ctx.provider, ctx.model_name) == ("Ollama", "llama3.1:8b")

    @pytest.mark.usefixtures("_provider_env")
    @pytest.mark.parametrize("value", ["", "gpt-small", "OpenAI:", ":gpt-small"])
    async def test_an_empty_or_malformed_setting_changes_nothing(self, monkeypatch, value):
        self._configure(monkeypatch, value)

        ctx = await assistant_router._resolve_assistant_context(
            _request(mode="ask", provider="OpenAI", model_name="gpt-big"), uuid4(), session=AsyncMock()
        )

        assert ctx.model_name == "gpt-big"

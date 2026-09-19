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

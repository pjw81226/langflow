from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from langflow.agentic.api.router import _AssistantContext
from langflow.agentic.api.schemas import InterviewResponse

_ROUTER = "langflow.agentic.api.router"


@pytest.fixture
def _agentic_enabled(monkeypatch):
    from langflow.services.deps import get_settings_service

    monkeypatch.setattr(get_settings_service().settings, "agentic_experience", True)


def _payload(flow_id: str) -> dict:
    return {
        "flow_id": flow_id,
        "stage": "examples",
        "answers": {
            "role": "품질 담당",
            "task": "매일 검사 결과를 정리해요",
            "sources": ["엑셀·CSV"],
            "process": "불량 항목을 찾고 기준과 비교해요",
            "output": "검사 보고서",
        },
    }


def _context() -> _AssistantContext:
    return _AssistantContext(
        provider="OpenAI",
        model_name="gpt-4o-mini",
        api_key_name="OPENAI_API_KEY",  # pragma: allowlist secret
        session_id="unused",
        global_vars={"OPENAI_API_KEY": "provider-secret"},  # pragma: allowlist secret
        max_retries=1,
    )


@pytest.mark.usefixtures("_agentic_enabled")
async def test_interview_requires_authentication_before_model_work(client: AsyncClient):
    resolver = AsyncMock(side_effect=AssertionError("provider discovery must not run"))

    with patch(f"{_ROUTER}._resolve_assistant_context", resolver):
        response = await client.post("api/v1/agentic/interview", json=_payload("not-a-uuid"))

    assert response.status_code in {401, 403}
    resolver.assert_not_awaited()


@pytest.mark.parametrize(
    ("flow_id", "expected_status"),
    [("not-a-uuid", 422), ("00000000-0000-4000-8000-000000000001", 404)],
)
@pytest.mark.usefixtures("_agentic_enabled")
async def test_interview_validates_flow_access_before_provider_or_model(
    client: AsyncClient,
    logged_in_headers,
    flow_id: str,
    expected_status: int,
):
    resolver = AsyncMock(side_effect=AssertionError("provider discovery must not run"))
    generator = AsyncMock(side_effect=AssertionError("model must not run"))

    with (
        patch(f"{_ROUTER}._resolve_assistant_context", resolver),
        patch(f"{_ROUTER}.generate_interview_response", generator),
    ):
        response = await client.post(
            "api/v1/agentic/interview",
            json=_payload(flow_id),
            headers=logged_in_headers,
        )

    assert response.status_code == expected_status, response.text
    resolver.assert_not_awaited()
    generator.assert_not_awaited()


@pytest.mark.usefixtures("_agentic_enabled")
async def test_interview_uses_flow_policy_and_releases_transaction_before_model(
    client: AsyncClient,
    simple_api_test,
    logged_in_headers,
):
    captured: dict = {}

    async def resolve(_request, _user_id, session):
        from lfx.services.model_provider_policy import current_model_provider_policy_context

        captured["session"] = session
        captured["resolver_policy"] = current_model_provider_policy_context()
        assert session.in_transaction()
        return _context()

    async def generate(_request, **kwargs):
        from lfx.services.model_provider_policy import current_model_provider_policy_context

        captured["model_policy"] = current_model_provider_policy_context()
        captured["in_transaction"] = captured["session"].in_transaction()
        captured["graph_data"] = kwargs["graph_data"]
        captured["provider_variables"] = kwargs["provider_variables"]
        return InterviewResponse(
            summary="역할에 맞는 예시입니다.",
            examples=["검사 결과 보고서 정리"],
            follow_up_questions=[],
            opportunities=[],
        )

    with (
        patch(f"{_ROUTER}._resolve_assistant_context", side_effect=resolve),
        patch(f"{_ROUTER}.generate_interview_response", side_effect=generate),
    ):
        response = await client.post(
            "api/v1/agentic/interview",
            json=_payload(simple_api_test["id"]),
            headers=logged_in_headers,
        )

    assert response.status_code == 200, response.text
    assert response.json()["examples"] == ["검사 결과 보고서 정리"]
    assert captured["resolver_policy"].attributes["provider_scope_required"] is True
    assert captured["model_policy"].attributes["provider_scope_required"] is True
    assert captured["in_transaction"] is False
    assert captured["graph_data"] == simple_api_test["data"]
    assert captured["provider_variables"]["OPENAI_API_KEY"] == "provider-secret"  # pragma: allowlist secret


@pytest.mark.usefixtures("_agentic_enabled")
async def test_interview_returns_safe_gateway_error_for_model_failure(
    client: AsyncClient,
    simple_api_test,
    logged_in_headers,
):
    from langflow.agentic.services.interview_service import InterviewGenerationError

    with (
        patch(f"{_ROUTER}._resolve_assistant_context", new=AsyncMock(return_value=_context())),
        patch(
            f"{_ROUTER}.generate_interview_response",
            new=AsyncMock(side_effect=InterviewGenerationError("인터뷰 응답을 만들지 못했습니다.")),
        ),
    ):
        response = await client.post(
            "api/v1/agentic/interview",
            json=_payload(simple_api_test["id"]),
            headers=logged_in_headers,
        )

    assert response.status_code == 502
    assert response.json() == {"detail": "인터뷰 응답을 만들지 못했습니다."}
    assert "provider-secret" not in response.text

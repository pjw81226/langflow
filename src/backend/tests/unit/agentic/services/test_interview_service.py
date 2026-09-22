from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from langflow.agentic.api.schemas import InterviewRequest


def _answers() -> dict:
    return {
        "role": "품질 담당",
        "task": "매일 검사 결과를 정리해요",
        "sources": ["엑셀·CSV"],
        "process": "불량 항목을 찾고 기준과 비교해요",
        "output": "검사 보고서",
        "frequency": "매일",
    }


def _opportunity(*, node_ids: list[str] | None = None) -> dict:
    return {
        "id": "inspection-report",
        "title": "검사 결과 정리",
        "description": "검사 결과를 기준에 따라 정리합니다.",
        "input": "검사 결과 CSV",
        "output": "검사 보고서",
        "review": "기준 밖 항목을 확인합니다.",
        "rules": [{"text": "기준 밖 항목은 사람이 확인", "source": "user"}],
        "steps": [
            {
                "id": "load",
                "label": "자료 열기",
                "description": "CSV를 읽습니다.",
                "kind": "input",
                "actor": "ai",
                "node_ids": node_ids or [],
            },
            {
                "id": "review",
                "label": "결과 확인",
                "description": "사람이 예외를 확인합니다.",
                "kind": "human",
                "actor": "user",
                "node_ids": [],
            },
            {
                "id": "report",
                "label": "보고서 만들기",
                "description": "결과를 요약합니다.",
                "kind": "output",
                "actor": "ai",
                "node_ids": [],
            },
        ],
        "edges": [
            {"source": "load", "target": "review", "label": "검사 결과"},
            {"source": "review", "target": "report", "label": "확인 완료"},
        ],
    }


def _response(*, opportunities=None, questions=None, examples=None) -> dict:
    return {
        "summary": "검사 업무를 정리했습니다.",
        "examples": examples or [],
        "follow_up_questions": questions or [],
        "opportunities": opportunities or [],
    }


class _FakeModel:
    def __init__(self, result=None, error: Exception | None = None):
        self._result = result
        self._error = error
        self.messages = None

    def with_structured_output(self, _schema):
        async def invoke(messages):
            self.messages = messages
            if self._error:
                raise self._error
            return self._result

        runnable = MagicMock()
        runnable.ainvoke = AsyncMock(side_effect=invoke)
        return runnable


async def _run(request: InterviewRequest, result: dict, *, graph_data=None):
    from langflow.agentic.services.interview_service import generate_interview_response

    model = _FakeModel(result)
    with patch("langflow.agentic.services.interview_service._build_language_model", return_value=model):
        response = await generate_interview_response(
            request,
            user_id=uuid4(),
            provider="OpenAI",
            model_name="gpt-4o-mini",
            api_key_name="OPENAI_API_KEY",  # pragma: allowlist secret
            provider_variables={"OPENAI_API_KEY": "provider-secret"},  # pragma: allowlist secret
            graph_data=graph_data,
        )
    return response, model


async def test_recommend_returns_grounded_opportunity():
    request = InterviewRequest(flow_id=str(uuid4()), stage="recommend", answers=_answers())

    response, model = await _run(request, _response(opportunities=[_opportunity()]))

    assert response.opportunities[0].title == "검사 결과 정리"
    assert response.follow_up_questions == []
    assert "provider-secret" not in str(model.messages)


async def test_recommend_demotes_ungrounded_user_rule_source():
    opportunity = _opportunity()
    opportunity["rules"] = [
        {"text": "불량률이 3%를 넘으면 자동 승인", "source": "user"},
        {"text": "불량 항목을 찾고 기준과 비교해요", "source": "user"},
    ]
    request = InterviewRequest(flow_id=str(uuid4()), stage="recommend", answers=_answers())

    response, _ = await _run(request, _response(opportunities=[opportunity]))

    assert [rule.source for rule in response.opportunities[0].rules] == ["suggested", "user"]


async def test_refine_returns_only_the_revised_opportunity():
    request = InterviewRequest(
        flow_id=str(uuid4()),
        stage="refine",
        answers=_answers(),
        opportunity=_opportunity(),
        feedback="검토 단계를 더 분명히 해주세요.",
    )
    revised = _opportunity()
    revised["review"] = "담당자가 기준 밖 항목을 한 건씩 확인합니다."

    response, _ = await _run(request, _response(opportunities=[revised]))

    assert len(response.opportunities) == 1
    assert response.opportunities[0].review == "담당자가 기준 밖 항목을 한 건씩 확인합니다."


async def test_refine_preserves_only_previously_grounded_user_rules():
    request = InterviewRequest(
        flow_id=str(uuid4()),
        stage="refine",
        answers=_answers(),
        opportunity=_opportunity(),
        feedback="담당자가 결과를 승인합니다.",
    )
    revised = _opportunity()
    revised["rules"] = [
        {"text": "기준 밖 항목은 사람이 확인", "source": "user"},
        {"text": "담당자가 결과를 승인합니다.", "source": "user"},
        {"text": "팀장이 매주 승인", "source": "user"},
    ]

    response, _ = await _run(request, _response(opportunities=[revised]))

    assert [rule.source for rule in response.opportunities[0].rules] == ["user", "user", "suggested"]


def test_model_builder_omits_temperature_for_provider_compatibility():
    from langflow.agentic.services.interview_service import _build_language_model

    component = MagicMock()
    component.build_model.return_value = object()
    with patch(
        "langflow.agentic.services.interview_service.LanguageModelComponent", return_value=component
    ) as component_class:
        _build_language_model(
            user_id=uuid4(),
            provider="OpenAI",
            model_name="gpt-6-astra",
            api_key_name="OPENAI_API_KEY",  # pragma: allowlist secret
            provider_variables={"OPENAI_API_KEY": "provider-secret"},  # pragma: allowlist secret
        )

    assert component_class.call_args.kwargs["temperature"] is None


async def test_recommend_limits_questions_to_remaining_budget():
    from langflow.agentic.services.interview_service import InterviewGenerationError

    request = InterviewRequest(
        flow_id=str(uuid4()),
        stage="recommend",
        answers=_answers(),
        follow_up_answers=[{"question": "기준은 무엇인가요?", "answer": "품질 기준"}],
    )

    with pytest.raises(InterviewGenerationError, match="인터뷰 응답을 만들지 못했습니다"):
        await _run(request, _response(questions=["추가 질문 1", "추가 질문 2"]))


async def test_recommend_after_question_budget_accepts_only_labeled_examples_or_opportunity():
    from langflow.agentic.services.interview_service import InterviewGenerationError

    request = InterviewRequest(
        flow_id=str(uuid4()),
        stage="recommend",
        answers=_answers(),
        follow_up_answers=[
            {"question": "기준은 무엇인가요?", "answer": "잘 모르겠어요"},
            {"question": "결과 형식은 무엇인가요?", "answer": "잘 모르겠어요"},
        ],
    )

    with pytest.raises(InterviewGenerationError):
        await _run(request, _response(questions=["세 번째 질문"]))
    with pytest.raises(InterviewGenerationError):
        await _run(request, _response(examples=["검사 결과 정리"]))

    response, _ = await _run(request, _response(examples=["예시: 검사 결과 정리"]))
    assert response.examples == ["예시: 검사 결과 정리"]


@pytest.mark.parametrize(
    "result",
    [
        "not-json",
        _response(questions=["질문 1", "질문 2", "질문 3"]),
        _response(
            opportunities=[
                {
                    **_opportunity(),
                    "edges": [{"source": "load", "target": "invented", "label": "잘못된 연결"}],
                }
            ]
        ),
    ],
)
async def test_invalid_model_output_returns_safe_error(result):
    from langflow.agentic.services.interview_service import InterviewGenerationError

    request = InterviewRequest(flow_id=str(uuid4()), stage="recommend", answers=_answers())

    with pytest.raises(InterviewGenerationError, match="인터뷰 응답을 만들지 못했습니다"):
        await _run(request, result)


async def test_provider_error_does_not_expose_secret():
    from langflow.agentic.services.interview_service import InterviewGenerationError, generate_interview_response

    request = InterviewRequest(flow_id=str(uuid4()), stage="recommend", answers=_answers())
    model = _FakeModel(error=ValueError("request failed with sk-provider-secret"))

    with (
        patch("langflow.agentic.services.interview_service._build_language_model", return_value=model),
        pytest.raises(InterviewGenerationError) as exc_info,
    ):
        await generate_interview_response(
            request,
            user_id=uuid4(),
            provider="OpenAI",
            model_name="gpt-4o-mini",
            api_key_name="OPENAI_API_KEY",  # pragma: allowlist secret
            provider_variables={"OPENAI_API_KEY": "sk-provider-secret"},  # pragma: allowlist secret
            graph_data=None,
        )

    assert "sk-provider-secret" not in str(exc_info.value)


async def test_explain_filters_node_ids_and_preserves_confirmed_rules():
    chosen = _opportunity()
    request = InterviewRequest(
        flow_id=str(uuid4()),
        stage="explain",
        answers=_answers(),
        opportunity=chosen,
    )
    explained = _opportunity(node_ids=["real-node", "invented-node"])
    explained["title"] = "모델이 바꾼 제목"
    explained["rules"] = [{"text": "모델이 만든 규칙", "source": "suggested"}]
    graph_data = {
        "nodes": [
            {"id": "real-node", "data": {"type": "File", "node": {"display_name": "파일"}}},
            {"id": "other-node", "data": {"type": "Parser", "node": {"display_name": "내용 읽기"}}},
        ],
        "edges": [],
    }

    response, model = await _run(request, _response(opportunities=[explained]), graph_data=graph_data)

    result = response.opportunities[0]
    assert result.title == "검사 결과 정리"
    assert result.rules[0].text == "기준 밖 항목은 사람이 확인"
    assert result.steps[0].node_ids == ["real-node"]
    assert "invented-node" not in result.model_dump_json()
    assert "provider-secret" not in str(model.messages)


def test_graph_projection_caps_nodes_and_discards_overlong_ids():
    from langflow.agentic.services.interview_service import _safe_graph_nodes

    graph_data = {
        "nodes": [
            {"id": "x" * 201, "data": {"type": "Overlong"}},
            *[{"id": f"node-{index}", "data": {"type": "Step"}} for index in range(201)],
        ]
    }

    nodes = _safe_graph_nodes(graph_data)

    assert len(nodes) == 200
    assert nodes[0]["id"] == "node-0"
    assert nodes[-1]["id"] == "node-199"

from uuid import uuid4

import pytest
from langflow.agentic.api.schemas import InterviewRequest, InterviewResponse
from pydantic import ValidationError


def _answers() -> dict:
    return {
        "role": "품질 담당",
        "task": "매일 검사 결과를 정리해요",
        "sources": ["엑셀·CSV"],
        "process": "불량 항목을 찾고 기준과 비교해요",
        "output": "검사 보고서",
    }


def _opportunity() -> dict:
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
                "node_ids": ["node-1"],
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
                "node_ids": ["node-2"],
            },
        ],
        "edges": [
            {"source": "load", "target": "review", "label": "검사 결과"},
            {"source": "review", "target": "report", "label": "확인 완료"},
        ],
    }


def test_interview_request_accepts_shared_contract():
    request = InterviewRequest(
        flow_id=str(uuid4()),
        stage="refine",
        answers=_answers(),
        follow_up_answers=[{"question": "어떤 기준인가요?", "answer": "사내 품질 기준"}],
        opportunity=_opportunity(),
        feedback="사람이 확인하는 단계를 더 분명히 해주세요.",
        provider="OpenAI",
        model_name="gpt-4o-mini",
    )

    assert request.stage == "refine"
    assert request.opportunity is not None
    assert request.opportunity.steps[1].node_ids == []


def test_examples_stage_accepts_only_role_answered():
    request = InterviewRequest(
        flow_id=str(uuid4()),
        stage="examples",
        answers={"role": "품질 담당", "task": "", "sources": [], "process": "", "output": ""},
    )

    assert request.answers.role == "품질 담당"
    assert request.answers.sources == []


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("follow_up_answers", [{"question": "q", "answer": "a"}] * 3),
        ("answers", {**_answers(), "sources": [str(index) for index in range(9)]}),
    ],
)
def test_interview_request_rejects_unbounded_collections(field: str, value):
    payload = {"flow_id": str(uuid4()), "stage": "recommend", "answers": _answers(), field: value}

    with pytest.raises(ValidationError):
        InterviewRequest.model_validate(payload)


def test_interview_request_requires_stage_inputs():
    with pytest.raises(ValidationError, match="opportunity"):
        InterviewRequest(flow_id=str(uuid4()), stage="refine", answers=_answers())


def test_interview_response_rejects_edge_to_unknown_step():
    opportunity = _opportunity()
    opportunity["edges"][0]["target"] = "missing"

    with pytest.raises(ValidationError, match="unknown step"):
        InterviewResponse(
            summary="검사 업무를 정리했습니다.",
            examples=[],
            follow_up_questions=[],
            opportunities=[opportunity],
        )


def test_interview_response_limits_clarification_budget_and_opportunities():
    with pytest.raises(ValidationError):
        InterviewResponse(
            summary="추가 확인이 필요합니다.",
            examples=[],
            follow_up_questions=["질문 1", "질문 2", "질문 3"],
            opportunities=[],
        )

    with pytest.raises(ValidationError):
        InterviewResponse(
            summary="후보를 정리했습니다.",
            examples=[],
            follow_up_questions=[],
            opportunities=[_opportunity()] * 4,
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"request": {"answers": {**_answers(), "sources": ["s" * 201]}}},
        {"response": {"examples": ["e" * 501]}},
        {"response": {"follow_up_questions": ["q" * 501]}},
        {
            "response": {
                "opportunities": [
                    {
                        **_opportunity(),
                        "steps": [
                            {**_opportunity()["steps"][0], "node_ids": ["n" * 201]},
                            *_opportunity()["steps"][1:],
                        ],
                    }
                ]
            }
        },
    ],
)
def test_interview_models_reject_overlong_collection_items(payload):
    if "request" in payload:
        request_payload = {
            "flow_id": str(uuid4()),
            "stage": "recommend",
            "answers": _answers(),
            **payload["request"],
        }
        with pytest.raises(ValidationError):
            InterviewRequest.model_validate(request_payload)
        return

    response_payload = {
        "summary": "검사 업무를 정리했습니다.",
        "examples": [],
        "follow_up_questions": [],
        "opportunities": [],
        **payload["response"],
    }
    with pytest.raises(ValidationError):
        InterviewResponse.model_validate(response_payload)


def test_human_step_discards_model_supplied_node_ids():
    opportunity = _opportunity()
    opportunity["steps"][1]["node_ids"] = ["invented-node"]

    response = InterviewResponse(
        summary="검사 업무를 정리했습니다.",
        examples=[],
        follow_up_questions=[],
        opportunities=[opportunity],
    )

    assert response.opportunities[0].steps[1].node_ids == []

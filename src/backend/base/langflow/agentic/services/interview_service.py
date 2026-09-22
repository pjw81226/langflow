"""Bounded structured-model service for the work interview."""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

from langchain_core.messages import HumanMessage, SystemMessage
from lfx.components.models_and_agents import LanguageModelComponent
from lfx.log.logger import logger
from pydantic import ValidationError

from langflow.agentic.api.schemas import InterviewRequest, InterviewResponse, WorkOpportunity
from langflow.agentic.flows.model_config import build_model_config

if TYPE_CHECKING:
    from uuid import UUID

INTERVIEW_MODEL_TIMEOUT_SECONDS = 45
INTERVIEW_MAX_TOKENS = 4096
INTERVIEW_MAX_GRAPH_NODES = 200
INTERVIEW_MAX_NODE_ID_LENGTH = 200

_SAFE_GENERATION_ERROR = "인터뷰 응답을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."

_SYSTEM_PROMPT = """당신은 비개발자의 실제 업무를 자동화 후보로 정리하는 인터뷰 도우미입니다.
사용자가 말하지 않은 조직, 절차, 도구, 판단 기준을 만들지 마세요. 정보가 충분한 업무만 제안하고,
충분하지 않으면 구체적인 확인 질문만 하세요. 제안은 한 개여도 됩니다.

응답은 제공된 스키마를 정확히 따르세요. 모든 배열을 명시하고, HTML이나 Markdown 없이 평문만 쓰세요.
단계는 3~6개로 제한하고 사람이 수행하는 단계는 kind="human", actor="user", node_ids=[]로 표시하세요.
규칙은 사용자가 직접 말한 내용은 source="user", 새로 확인이 필요한 제안은 source="suggested"로 표시하세요.
"""

_STAGE_INSTRUCTIONS = {
    "examples": (
        "역할에 맞는 업무 예시를 examples에 3~6개 제시하세요. "
        "follow_up_questions와 opportunities는 빈 배열이어야 합니다."
    ),
    "refine": (
        "선택된 기회 하나만 사용자의 feedback에 맞게 수정하세요. "
        "새 기회를 추가하지 말고 examples와 follow_up_questions는 비우세요."
    ),
    "explain": (
        "선택된 기회의 업무 내용과 확정된 규칙은 바꾸지 마세요. 저장된 그래프의 실제 노드만 사용해 "
        "단계 설명과 node_ids를 연결한 기회 하나를 반환하세요. 목록에 없는 노드 ID를 만들지 마세요. "
        "examples와 follow_up_questions는 비우세요."
    ),
}


class InterviewGenerationError(RuntimeError):
    """A provider or validation failure safe to expose through the API."""


async def generate_interview_response(
    request: InterviewRequest,
    *,
    user_id: UUID,
    provider: str,
    model_name: str,
    api_key_name: str | None,
    provider_variables: dict[str, str],
    graph_data: dict | None,
) -> InterviewResponse:
    """Run one structured interview turn without tools or graph mutation."""
    try:
        llm = _build_language_model(
            user_id=user_id,
            provider=provider,
            model_name=model_name,
            api_key_name=api_key_name,
            provider_variables=provider_variables,
        )
        runnable = llm.with_structured_output(InterviewResponse)
        messages = [
            SystemMessage(content=f"{_SYSTEM_PROMPT}\n\n{_stage_instruction(request)}"),
            HumanMessage(content=_build_model_input(request, graph_data)),
        ]
        async with asyncio.timeout(INTERVIEW_MODEL_TIMEOUT_SECONDS):
            raw_response = await runnable.ainvoke(messages)
        response = _validate_response(raw_response)
        response = _normalize_rule_provenance(request, response)
        response = _validate_stage_response(request, response)
        if request.stage == "explain":
            response = _filter_explanation(request, response, graph_data)
    except InterviewGenerationError:
        raise
    except Exception as exc:  # noqa: BLE001 - provider SDKs expose unrelated exception hierarchies
        await logger.awarning(
            "work_interview_generation_failed",
            extra={"stage": request.stage, "error_type": type(exc).__name__},
        )
        raise InterviewGenerationError(_SAFE_GENERATION_ERROR) from None
    return response


def _build_language_model(
    *,
    user_id: UUID,
    provider: str,
    model_name: str,
    api_key_name: str | None,
    provider_variables: dict[str, str],
):
    api_key = provider_variables.get(api_key_name) if api_key_name else None
    component = LanguageModelComponent(
        user_id=str(user_id),
        model=build_model_config(provider, model_name),
        api_key=api_key,
        temperature=None,
        stream=False,
        max_tokens=INTERVIEW_MAX_TOKENS,
        base_url_ibm_watsonx=provider_variables.get("WATSONX_URL"),
        project_id=provider_variables.get("WATSONX_PROJECT_ID"),
        ollama_base_url=provider_variables.get("OLLAMA_BASE_URL"),
    )
    return component.build_model()


def _build_model_input(request: InterviewRequest, graph_data: dict | None) -> str:
    content: dict[str, Any] = {
        "stage": request.stage,
        "answers": request.answers.model_dump(exclude_none=True),
        "follow_up_answers": [answer.model_dump() for answer in request.follow_up_answers or []],
        "opportunity": request.opportunity.model_dump() if request.opportunity else None,
        "feedback": request.feedback,
    }
    if request.stage == "explain":
        content["stored_graph_nodes"] = _safe_graph_nodes(graph_data)
    return json.dumps(content, ensure_ascii=False, separators=(",", ":"))


def _stage_instruction(request: InterviewRequest) -> str:
    if request.stage != "recommend":
        return _STAGE_INSTRUCTIONS[request.stage]
    remaining_questions = 2 - len(request.follow_up_answers or [])
    if remaining_questions == 0:
        return (
            "추가 질문은 하지 마세요. 답변으로 뒷받침되는 기회를 opportunities에 1~3개 제시하세요. "
            "실제 기회를 만들 정보가 부족하면 opportunities와 follow_up_questions를 비우고, "
            "examples에 '예시:'로 시작하는 일반 예시만 제시하세요."
        )
    return (
        "답변이 충분하면 실제로 뒷받침되는 기회를 opportunities에 1~3개 제시하고 질문은 비우세요. "
        f"부족하면 opportunities를 비우고, 아직 답하지 않은 구체적인 질문을 최대 {remaining_questions}개만 "
        "제시하세요. 실제 기회나 질문을 만들 수 없다면 '예시:'로 시작하는 일반 예시를 examples에 제시하세요."
    )


def _safe_graph_nodes(graph_data: dict | None) -> list[dict[str, str]]:
    nodes: list[dict[str, str]] = []
    raw_nodes = (graph_data or {}).get("nodes", [])
    if not isinstance(raw_nodes, list):
        return nodes
    for raw_node in raw_nodes:
        if len(nodes) == INTERVIEW_MAX_GRAPH_NODES:
            break
        if not isinstance(raw_node, dict) or not isinstance(raw_node.get("id"), str):
            continue
        if len(raw_node["id"]) > INTERVIEW_MAX_NODE_ID_LENGTH:
            continue
        raw_data = raw_node.get("data")
        data: dict = raw_data if isinstance(raw_data, dict) else {}
        raw_component = data.get("node")
        node: dict = raw_component if isinstance(raw_component, dict) else {}
        label = node.get("display_name") or data.get("type") or "단계"
        nodes.append({"id": raw_node["id"], "label": str(label)[:200]})
    return nodes


def _validate_response(raw_response: Any) -> InterviewResponse:
    if isinstance(raw_response, InterviewResponse):
        return raw_response
    try:
        return InterviewResponse.model_validate(raw_response)
    except (TypeError, ValidationError) as exc:
        raise InterviewGenerationError(_SAFE_GENERATION_ERROR) from exc


def _normalize_rule_provenance(request: InterviewRequest, response: InterviewResponse) -> InterviewResponse:
    """Only trust ``source=user`` when the exact rule text is present in user-owned input."""
    if request.stage == "explain":
        return response

    answers = request.answers
    grounded_text = [
        answers.role,
        answers.task,
        *answers.sources,
        answers.process,
        answers.output,
        answers.frequency or "",
        *(answer.answer for answer in request.follow_up_answers or []),
    ]
    if request.stage == "refine":
        grounded_text.append(request.feedback or "")
        if request.opportunity is not None:
            grounded_text.extend(rule.text for rule in request.opportunity.rules if rule.source == "user")

    normalized_opportunities = []
    for opportunity in response.opportunities:
        normalized_rules = [
            rule.model_copy(
                update={
                    "source": (
                        "user"
                        if rule.source == "user" and any(rule.text in text for text in grounded_text)
                        else "suggested"
                    )
                }
            )
            for rule in opportunity.rules
        ]
        normalized_opportunities.append(opportunity.model_copy(update={"rules": normalized_rules}))

    normalized = response.model_copy(update={"opportunities": normalized_opportunities})
    return InterviewResponse.model_validate(normalized.model_dump())


def _validate_stage_response(request: InterviewRequest, response: InterviewResponse) -> InterviewResponse:
    if request.stage == "examples":
        valid = bool(response.examples) and not response.opportunities and not response.follow_up_questions
    elif request.stage == "recommend":
        remaining_questions = 2 - len(request.follow_up_answers or [])
        has_opportunities = bool(response.opportunities)
        has_questions = bool(response.follow_up_questions)
        has_labeled_examples = bool(response.examples) and all(
            example.lstrip().startswith(("예시:", "예시\uff1a")) for example in response.examples
        )
        valid = (
            (has_opportunities and not has_questions and not response.examples)
            or (
                has_questions
                and not has_opportunities
                and not response.examples
                and len(response.follow_up_questions) <= remaining_questions
            )
            or (has_labeled_examples and not has_opportunities and not has_questions)
        )
    else:
        valid = len(response.opportunities) == 1 and not response.examples and not response.follow_up_questions
    if not valid:
        raise InterviewGenerationError(_SAFE_GENERATION_ERROR)
    return response


def _filter_explanation(
    request: InterviewRequest,
    response: InterviewResponse,
    graph_data: dict | None,
) -> InterviewResponse:
    chosen = request.opportunity
    if chosen is None:
        raise InterviewGenerationError(_SAFE_GENERATION_ERROR)
    valid_node_ids = {node["id"] for node in _safe_graph_nodes(graph_data)}
    explanation = response.opportunities[0]
    filtered_steps = [
        step.model_copy(
            update={
                "node_ids": []
                if step.kind == "human"
                else [node_id for node_id in step.node_ids if node_id in valid_node_ids]
            }
        )
        for step in explanation.steps
    ]
    preserved = chosen.model_copy(update={"steps": filtered_steps, "edges": explanation.edges})
    # Revalidate after copying because model_copy intentionally skips validators.
    preserved = WorkOpportunity.model_validate(preserved.model_dump())
    return response.model_copy(update={"opportunities": [preserved]})

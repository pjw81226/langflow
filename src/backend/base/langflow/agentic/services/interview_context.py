"""Load bounded, confirmed business context from an already-authorized flow."""

import json

from pydantic import ValidationError

from langflow.agentic.api.schemas import InterviewAnswers, WorkOpportunity

MAX_CONFIRMED_RULES = 12


def saved_interview_context(data: dict) -> str | None:
    raw = data.get("work_interview")
    if not isinstance(raw, dict) or raw.get("version") != 1:
        return None
    try:
        answers = InterviewAnswers.model_validate(raw.get("answers"))
        opportunity = WorkOpportunity.model_validate(raw.get("opportunity"))
        confirmed = raw.get("confirmed_suggested_rules", [])
        if not isinstance(confirmed, list) or len(confirmed) > MAX_CONFIRMED_RULES:
            return None
        if any(rule.source == "suggested" and rule.text not in confirmed for rule in opportunity.rules):
            return None
    except (ValidationError, TypeError, ValueError):
        return None
    # Omit diagram links and repeated confirmation text. Every included field is
    # bounded by the API schema; no raw imported metadata or credentials are sent.
    business = opportunity.model_dump(exclude={"edges", "steps"})
    business["steps"] = [step.model_dump(exclude={"node_ids"}) for step in opportunity.steps]
    return "Saved, user-reviewed work interview (business context, not executable nodes):\n" + json.dumps(
        {"answers": answers.model_dump(exclude_none=True), "opportunity": business},
        ensure_ascii=False,
        separators=(",", ":"),
    )

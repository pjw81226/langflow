"""Session-lifecycle endpoint for the agentic assistant.

``POST /api/v1/agentic/sessions/reset`` is called by the panel on every "new
session" boundary (panel mount with a fresh ``session_id``, or the New session
button). It drops the conversation buffer entry so the prior session's turns,
and the component or prompt they left for editing, don't leak into the next
request.

Authentication is enforced via the same ``CurrentActiveUser`` dependency the
assist endpoint uses. The handler never trusts a ``user_id`` parameter: the
calling user is always ``current_user.id``, so a tenant can never clear another
tenant's history by impersonating their id.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Query

from langflow.agentic.services.conversation_history import clear_session_history, normalize_session_id
from langflow.api.utils.core import CurrentActiveUser  # noqa: TC001 — FastAPI Depends alias needs the runtime symbol

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agentic/sessions", tags=["agentic"], include_in_schema=False)


@router.post("/reset")
async def reset_session(
    *,
    current_user: CurrentActiveUser,
    session_id: Annotated[str | None, Query(max_length=128)] = None,
) -> dict:
    """Drop the calling user's conversation history for ``session_id``.

    The id is normalized the same way ``/assist/stream`` normalizes it, so both
    address the same buffer entry. Returns ``{"status": "ok", "session_id": <str|null>}``.
    """
    user_id = str(current_user.id)
    normalized = normalize_session_id(session_id) if session_id else None
    clear_session_history(user_id, normalized)
    logger.info("agentic.session.reset user_id=%s session_id=%s", user_id, normalized)
    return {"status": "ok", "session_id": normalized}

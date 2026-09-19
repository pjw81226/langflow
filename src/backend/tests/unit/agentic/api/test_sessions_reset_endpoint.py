"""POST /api/v1/agentic/sessions/reset endpoint.

The panel calls this on every "new assistant session" boundary (a fresh
session id on mount, or the New session button). The endpoint drops the
conversation buffer entry for that session, including the component or prompt
a turn left for editing. It never touches another user's history.

We exercise the handler directly (not via TestClient) so the auth dependency is
bypassed via an injected ``current_user`` stand-in.
"""

from __future__ import annotations

import types

import pytest
from langflow.agentic.api.sessions_router import reset_session
from langflow.agentic.services.conversation_buffer import ConversationBuffer, ConversationTurn


@pytest.fixture
def buffer(monkeypatch: pytest.MonkeyPatch) -> ConversationBuffer:
    import langflow.agentic.services.conversation_buffer as module

    fresh = ConversationBuffer()
    monkeypatch.setattr(module, "_singleton", fresh)
    return fresh


def _user(user_id: str = "user-alice"):
    """The handler only reads ``current_user.id``."""
    return types.SimpleNamespace(id=user_id)


async def test_should_drop_the_sessions_history_and_artifacts(buffer: ConversationBuffer) -> None:
    buffer.push("user-alice", "agentic_xxx", ConversationTurn(user="hi", assistant="hello", artifact="code"))

    result = await reset_session(current_user=_user(), session_id="agentic_xxx")

    assert buffer.get_recent("user-alice", "agentic_xxx") == []
    assert result == {"status": "ok", "session_id": "agentic_xxx"}


async def test_should_address_the_same_entry_the_stream_route_uses(buffer: ConversationBuffer) -> None:
    """The stream route prefixes a bare id with ``agentic_``; the reset must clear that entry."""
    buffer.push("user-alice", "agentic_abc", ConversationTurn(user="hi", assistant="hello"))

    result = await reset_session(current_user=_user(), session_id="abc")

    assert buffer.get_recent("user-alice", "agentic_abc") == []
    assert result["session_id"] == "agentic_abc"


async def test_should_not_touch_another_users_session(buffer: ConversationBuffer) -> None:
    buffer.push("user-bob", "agentic_xxx", ConversationTurn(user="hi", assistant="hello"))

    await reset_session(current_user=_user("user-alice"), session_id="agentic_xxx")

    assert len(buffer.get_recent("user-bob", "agentic_xxx")) == 1


async def test_should_accept_a_missing_session_id(buffer: ConversationBuffer) -> None:  # noqa: ARG001
    result = await reset_session(current_user=_user(), session_id=None)

    assert result == {"status": "ok", "session_id": None}

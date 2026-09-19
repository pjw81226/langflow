"""Tests for the conversation history every assistant turn shares.

These tests pin:
    1. When a session has prior turns in the buffer, the agent's input
       gets prefixed with a ``[Conversation history]`` block (oldest-first).
    2. After a successful run, the (user, assistant) turn is appended
       to the buffer for that session, with any artifact it produced.
    3. Session ids always carry the prefix that hides them from the Playground.
    4. A new session can drop the prior session's buffer entry.

Wiring is exercised by patching the buffer module's singleton accessor —
we don't need to drive the full SSE flow.
"""

from __future__ import annotations

import pytest
from langflow.agentic.services.conversation_buffer import (
    ConversationBuffer,
    ConversationTurn,
)


@pytest.fixture
def fresh_buffer(monkeypatch):
    """Swap the module-level singleton with a fresh, empty buffer."""
    import langflow.agentic.services.conversation_buffer as module

    buf = ConversationBuffer()
    monkeypatch.setattr(module, "_singleton", buf)
    return buf


def test_inject_history_should_prefix_input_with_oldest_first_turns(fresh_buffer):
    """Prior turns are injected before the new input."""
    from langflow.agentic.services.conversation_history import inject_conversation_history

    fresh_buffer.push(
        "alice",
        "s1",
        ConversationTurn(user="how do I add Memory?", assistant="Use the Memory component."),
    )
    fresh_buffer.push(
        "alice",
        "s1",
        ConversationTurn(user="and a tool?", assistant="Add WebCrawler."),
    )

    wrapped = inject_conversation_history(
        user_id="alice",
        session_id="s1",
        input_value="now build the flow",
    )

    # Oldest turn first; newest just before the user's current input.
    idx_old = wrapped.find("how do I add Memory?")
    idx_new = wrapped.find("and a tool?")
    idx_user = wrapped.find("now build the flow")
    assert idx_old < idx_new < idx_user, "Turns must be oldest-first then the live input"
    # Loose framing assertion — must distinguish history from new input.
    assert "Conversation history" in wrapped


def test_inject_history_should_return_unchanged_input_when_no_session_history(
    fresh_buffer,  # noqa: ARG001 — fixture patches the singleton to a fresh buffer
):
    from langflow.agentic.services.conversation_history import inject_conversation_history

    wrapped = inject_conversation_history(user_id="alice", session_id="never-pushed", input_value="hi")

    assert wrapped == "hi"


def test_inject_history_should_return_unchanged_input_when_session_id_none(
    fresh_buffer,  # noqa: ARG001 — fixture patches the singleton to a fresh buffer
):
    # An anonymous request (no session_id) carries no history — must
    # noop rather than blow up.
    from langflow.agentic.services.conversation_history import inject_conversation_history

    wrapped = inject_conversation_history(user_id="alice", session_id=None, input_value="hi")

    assert wrapped == "hi"


def test_inject_history_should_return_unchanged_input_when_user_id_none(
    fresh_buffer,  # noqa: ARG001 — fixture patches the singleton to a fresh buffer
):
    # Anonymous tenant (no auth context). Refuse to read shared state.
    from langflow.agentic.services.conversation_history import inject_conversation_history

    wrapped = inject_conversation_history(user_id=None, session_id="s1", input_value="hi")

    assert wrapped == "hi"


def test_record_turn_should_push_completed_exchange_to_buffer(fresh_buffer):
    from langflow.agentic.services.conversation_history import record_conversation_turn

    record_conversation_turn(
        user_id="alice",
        session_id="s1",
        user_input="build a flow",
        assistant_response="Built the flow.",
    )

    recent = fresh_buffer.get_recent("alice", "s1")
    assert len(recent) == 1
    assert recent[0].user == "build a flow"
    assert recent[0].assistant == "Built the flow."


def test_record_turn_should_skip_when_session_id_none(fresh_buffer):
    from langflow.agentic.services.conversation_history import record_conversation_turn

    record_conversation_turn(
        user_id="alice",
        session_id=None,
        user_input="anonymous",
        assistant_response="reply",
    )

    # Nothing pushed — anonymous requests don't share history.
    assert fresh_buffer.get_recent("alice", "anonymous") == []


def test_record_turn_should_skip_when_user_id_none(fresh_buffer):
    from langflow.agentic.services.conversation_history import record_conversation_turn

    record_conversation_turn(
        user_id=None,
        session_id="s1",
        user_input="no-tenant",
        assistant_response="reply",
    )

    # Nothing pushed — anonymous tenant cannot share history.
    assert fresh_buffer.get_recent("", "s1") == []


def test_record_turn_should_skip_empty_responses(fresh_buffer):
    # A cancelled or errored turn ends up with an empty assistant_response.
    # Storing it would just pollute the next turn's context.
    from langflow.agentic.services.conversation_history import record_conversation_turn

    record_conversation_turn(
        user_id="alice",
        session_id="s1",
        user_input="will be cancelled",
        assistant_response="",
    )

    assert fresh_buffer.get_recent("alice", "s1") == []


class TestCrossTenantIsolation:
    """SECURITY regression — buffer MUST partition by user_id, not just session_id.

    Bug shape: ``session_id`` is a frontend-generated UUID. Anyone who learns
    Alice's session_id (via Langfuse/log exfil, X-Session-Id header echoing,
    operational hooks, or a misconfigured observability sink) can POST it as
    their own session_id and read Alice's conversation history in their prompt.

    Fix shape: key the buffer by the composite ``(user_id, session_id)``.
    """

    def test_should_not_leak_history_to_a_different_user_with_the_same_session_id(
        self,
        fresh_buffer,  # noqa: ARG002 — fixture patches the singleton to a fresh buffer
    ):
        from langflow.agentic.services.conversation_history import (
            inject_conversation_history,
            record_conversation_turn,
        )

        # Arrange — Alice records a turn carrying private content under sid "s1".
        record_conversation_turn(
            user_id="alice",
            session_id="s1",
            user_input="my private credential is hunter2",
            assistant_response="acknowledged",
        )

        # Act — Bob (different tenant) POSTs the SAME session_id.
        wrapped = inject_conversation_history(
            user_id="bob",
            session_id="s1",
            input_value="what was just said?",
        )

        # Assert — Bob's prompt MUST NOT contain any of Alice's content.
        assert "hunter2" not in wrapped, (
            "Cross-tenant data leak: Bob received Alice's conversation history "
            "by reusing her session_id. ConversationBuffer must be partitioned "
            "by (user_id, session_id), not by session_id alone."
        )
        assert "my private credential" not in wrapped
        assert "Conversation history" not in wrapped, (
            "Bob's prompt should have NO history block at all — his (user_id, sid) "
            "key is fresh, so the buffer must report 0 turns."
        )

    def test_should_still_return_owner_history_when_same_user_reuses_session_id(
        self,
        fresh_buffer,  # noqa: ARG002 — fixture patches the singleton to a fresh buffer
    ):
        # Sanity twin: the same user (matching user_id + session_id) STILL sees
        # their own history. Proves the fix doesn't over-isolate.
        from langflow.agentic.services.conversation_history import (
            inject_conversation_history,
            record_conversation_turn,
        )

        record_conversation_turn(
            user_id="alice",
            session_id="s1",
            user_input="how do I add Memory?",
            assistant_response="Use the Memory component.",
        )

        wrapped = inject_conversation_history(
            user_id="alice",
            session_id="s1",
            input_value="and a tool?",
        )

        assert "how do I add Memory?" in wrapped
        assert "Conversation history" in wrapped


class TestHistoryCostBounds:
    """The injected history is a per-iteration prompt cost.

    Every agent iteration re-sends it, so injection must be bounded — the
    buffer may retain MAX_TURNS_PER_SESSION turns, but only HISTORY_TURN_LIMIT
    of them (each field capped at MAX_TURN_FIELD_CHARS) reach the prompt.
    """

    def test_inject_history_should_cap_turns_to_history_turn_limit(self, fresh_buffer, monkeypatch):
        from langflow.agentic.services.conversation_buffer import HISTORY_TURN_LIMIT
        from langflow.agentic.services.conversation_history import inject_conversation_history

        # Isolate the default cap from an ambient LANGFLOW_ASSISTANT_HISTORY_TURNS.
        monkeypatch.delenv("LANGFLOW_ASSISTANT_HISTORY_TURNS", raising=False)
        total = HISTORY_TURN_LIMIT + 3
        for i in range(total):
            fresh_buffer.push("alice", "s1", ConversationTurn(user=f"question-{i}", assistant=f"answer-{i}"))

        wrapped = inject_conversation_history(user_id="alice", session_id="s1", input_value="next")

        for i in range(total - HISTORY_TURN_LIMIT):
            assert f"question-{i}" not in wrapped
        for i in range(total - HISTORY_TURN_LIMIT, total):
            assert f"question-{i}" in wrapped

    def test_inject_history_should_truncate_overlong_fields(self, fresh_buffer):
        from langflow.agentic.services.conversation_buffer import MAX_TURN_FIELD_CHARS
        from langflow.agentic.services.conversation_history import inject_conversation_history

        long_reply = "x" * (MAX_TURN_FIELD_CHARS * 3)
        fresh_buffer.push("alice", "s1", ConversationTurn(user="short", assistant=long_reply))

        wrapped = inject_conversation_history(user_id="alice", session_id="s1", input_value="next")

        assert long_reply not in wrapped
        assert "[truncated]" in wrapped
        assert len(wrapped) < MAX_TURN_FIELD_CHARS * 2

    def test_history_turn_limit_should_be_env_tunable(self, fresh_buffer, monkeypatch):
        from langflow.agentic.services.conversation_history import inject_conversation_history

        monkeypatch.setenv("LANGFLOW_ASSISTANT_HISTORY_TURNS", "2")
        for i in range(5):
            fresh_buffer.push("alice", "s1", ConversationTurn(user=f"question-{i}", assistant=f"answer-{i}"))

        wrapped = inject_conversation_history(user_id="alice", session_id="s1", input_value="next")

        assert "question-2" not in wrapped
        assert "question-3" in wrapped
        assert "question-4" in wrapped

    def test_history_turns_env_zero_should_disable_injection_entirely(self, fresh_buffer, monkeypatch):
        # limit=0 must mean "no history", not "all history" (turns[-0:] bug).
        from langflow.agentic.services.conversation_history import inject_conversation_history

        monkeypatch.setenv("LANGFLOW_ASSISTANT_HISTORY_TURNS", "0")
        for i in range(3):
            fresh_buffer.push("alice", "s1", ConversationTurn(user=f"question-{i}", assistant=f"answer-{i}"))

        wrapped = inject_conversation_history(user_id="alice", session_id="s1", input_value="next")

        assert wrapped == "next"

    def test_invalid_env_value_should_fall_back_to_default(self, fresh_buffer, monkeypatch):
        from langflow.agentic.services.conversation_buffer import HISTORY_TURN_LIMIT
        from langflow.agentic.services.conversation_history import inject_conversation_history

        monkeypatch.setenv("LANGFLOW_ASSISTANT_HISTORY_TURNS", "not-a-number")
        total = HISTORY_TURN_LIMIT + 2
        for i in range(total):
            fresh_buffer.push("alice", "s1", ConversationTurn(user=f"question-{i}", assistant=f"answer-{i}"))

        wrapped = inject_conversation_history(user_id="alice", session_id="s1", input_value="next")

        assert f"question-{total - 1}" in wrapped
        assert "question-0" not in wrapped


class TestHistoryLimitOverride:
    """The /history command passes an explicit limit that beats the env default."""

    def test_limit_override_caps_injection_regardless_of_env(self, fresh_buffer, monkeypatch):
        from langflow.agentic.services.conversation_history import inject_conversation_history

        monkeypatch.setenv("LANGFLOW_ASSISTANT_HISTORY_TURNS", "6")
        for i in range(5):
            fresh_buffer.push("alice", "s1", ConversationTurn(user=f"q-{i}", assistant=f"a-{i}"))

        wrapped = inject_conversation_history(user_id="alice", session_id="s1", input_value="next", limit_override=2)

        # Only the last 2 turns injected, despite the env allowing 6.
        assert "q-4" in wrapped
        assert "q-3" in wrapped
        assert "q-2" not in wrapped

    def test_limit_override_zero_injects_nothing(self, fresh_buffer):
        from langflow.agentic.services.conversation_history import inject_conversation_history

        fresh_buffer.push("alice", "s1", ConversationTurn(user="q-0", assistant="a-0"))
        wrapped = inject_conversation_history(user_id="alice", session_id="s1", input_value="next", limit_override=0)
        assert wrapped == "next"


def test_clear_session_history_should_drop_the_named_session(fresh_buffer):
    from langflow.agentic.services.conversation_history import clear_session_history

    fresh_buffer.push("alice", "s1", ConversationTurn(user="x", assistant="y"))
    fresh_buffer.push("alice", "s2", ConversationTurn(user="a", assistant="b"))

    clear_session_history("alice", "s1")

    assert fresh_buffer.get_recent("alice", "s1") == []
    # Sibling session is untouched.
    assert len(fresh_buffer.get_recent("alice", "s2")) == 1


def test_clear_session_history_should_skip_when_session_id_none(fresh_buffer):
    from langflow.agentic.services.conversation_history import clear_session_history

    fresh_buffer.push("alice", "s1", ConversationTurn(user="x", assistant="y"))
    # Should not raise and should not touch any session.
    clear_session_history("alice", None)
    assert len(fresh_buffer.get_recent("alice", "s1")) == 1


def test_clear_session_history_should_skip_when_user_id_none(fresh_buffer):
    from langflow.agentic.services.conversation_history import clear_session_history

    fresh_buffer.push("alice", "s1", ConversationTurn(user="x", assistant="y"))
    # Should not raise and should not touch any session.
    clear_session_history(None, "s1")
    assert len(fresh_buffer.get_recent("alice", "s1")) == 1


def test_clear_session_history_should_not_drop_other_users_session_with_same_id(fresh_buffer):
    """SECURITY twin: ``clear`` is also keyed by ``(user_id, session_id)``.

    One tenant cannot wipe another's buffer by guessing/replaying a session_id.
    """
    from langflow.agentic.services.conversation_history import clear_session_history

    fresh_buffer.push("alice", "s1", ConversationTurn(user="x", assistant="y"))

    # Bob attempts to clear Alice's session by posting the same session_id.
    clear_session_history("bob", "s1")

    # Alice's history must survive.
    assert len(fresh_buffer.get_recent("alice", "s1")) == 1


def test_clear_session_history_should_be_idempotent_for_unknown_session(
    fresh_buffer,  # noqa: ARG001 — fixture patches the singleton to a fresh buffer
):
    from langflow.agentic.services.conversation_history import clear_session_history

    clear_session_history("alice", "never-pushed")  # no error


class TestSessionIdNormalization:
    """Assistant sessions must stay out of the Playground's session list."""

    def test_should_prefix_a_client_session_id(self):
        from langflow.agentic.services.conversation_history import normalize_session_id

        assert normalize_session_id("abc") == "agentic_abc"

    def test_should_keep_an_already_prefixed_id(self):
        from langflow.agentic.services.conversation_history import normalize_session_id

        assert normalize_session_id("agentic_abc") == "agentic_abc"

    @pytest.mark.parametrize("missing", [None, "", "   "])
    def test_should_mint_a_prefixed_id_when_none_is_sent(self, missing):
        from langflow.agentic.services.conversation_history import normalize_session_id

        minted = normalize_session_id(missing)

        assert minted.startswith("agentic_")
        assert len(minted) > len("agentic_")
        assert normalize_session_id(missing) != minted


class TestArtifacts:
    """A turn can leave its component code or prompt for the next turn to edit."""

    def test_record_should_keep_the_artifact_out_of_the_prompt_history(self, fresh_buffer):
        from langflow.agentic.services.conversation_history import (
            inject_conversation_history,
            record_conversation_turn,
        )

        record_conversation_turn(
            user_id="alice",
            session_id="s1",
            user_input="count words",
            assistant_response="[Component WordCounterComponent: validated]",
            mode="component",
            artifact="class WordCounterComponent(Component): ...",
        )

        injected = inject_conversation_history(user_id="alice", session_id="s1", input_value="add an input")

        assert "WordCounterComponent: validated" in injected
        assert "class WordCounterComponent" not in injected
        assert fresh_buffer.get_recent("alice", "s1")[0].artifact.startswith("class WordCounterComponent")

    def test_record_should_cap_the_artifact(self, fresh_buffer):
        from langflow.agentic.services.conversation_history import MAX_ARTIFACT_CHARS, record_conversation_turn

        record_conversation_turn(
            user_id="alice",
            session_id="s1",
            user_input="x",
            assistant_response="y",
            mode="component",
            artifact="a" * (MAX_ARTIFACT_CHARS + 50),
        )

        assert len(fresh_buffer.get_recent("alice", "s1")[0].artifact) == MAX_ARTIFACT_CHARS

    def test_last_artifact_should_return_the_newest_artifact_of_the_mode(self, fresh_buffer):
        from langflow.agentic.services.conversation_history import last_artifact

        fresh_buffer.push("alice", "s1", ConversationTurn(user="a", assistant="b", mode="component", artifact="v1"))
        fresh_buffer.push("alice", "s1", ConversationTurn(user="c", assistant="d", mode="component", artifact="v2"))
        fresh_buffer.push("alice", "s1", ConversationTurn(user="e", assistant="f", mode="ask"))

        assert last_artifact(user_id="alice", session_id="s1", mode="component") == "v2"

    def test_last_artifact_should_skip_turns_that_left_none(self, fresh_buffer):
        from langflow.agentic.services.conversation_history import last_artifact

        fresh_buffer.push("alice", "s1", ConversationTurn(user="a", assistant="b", mode="component", artifact="v1"))
        fresh_buffer.push("alice", "s1", ConversationTurn(user="which input?", assistant="Text?", mode="component"))

        assert last_artifact(user_id="alice", session_id="s1", mode="component") == "v1"

    def test_last_artifact_should_match_the_reference_when_given(self, fresh_buffer):
        from langflow.agentic.services.conversation_history import last_artifact

        fresh_buffer.push(
            "alice",
            "s1",
            ConversationTurn(user="a", assistant="b", mode="prompt", artifact="for A", artifact_ref="A:system_prompt"),
        )
        fresh_buffer.push(
            "alice",
            "s1",
            ConversationTurn(user="c", assistant="d", mode="prompt", artifact="for B", artifact_ref="B:system_prompt"),
        )

        assert last_artifact(user_id="alice", session_id="s1", mode="prompt", artifact_ref="A:system_prompt") == "for A"
        assert last_artifact(user_id="alice", session_id="s1", mode="prompt", artifact_ref="C:system_prompt") is None

    def test_last_artifact_should_not_read_another_users_session(self, fresh_buffer):
        from langflow.agentic.services.conversation_history import last_artifact

        fresh_buffer.push("alice", "s1", ConversationTurn(user="a", assistant="b", mode="component", artifact="mine"))

        assert last_artifact(user_id="mallory", session_id="s1", mode="component") is None
        assert last_artifact(user_id=None, session_id="s1", mode="component") is None

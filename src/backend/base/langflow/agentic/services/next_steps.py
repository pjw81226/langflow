"""Follow-up suggestions the Ask agent puts at the end of an answer.

An answer usually ends with something the user would do next, and only the
answer's own content knows what that is. So the Ask agent writes it: a block
fenced by four backticks and tagged ``next``, holding one or two
``label | tab | message`` lines. This module takes that block out of the answer
and hands the panel the suggestions, which it turns into buttons that open the
tab and fill the composer.

Everything here is untrusted model output: the block is dropped whole unless it
parses, and labels and messages are length-capped before they reach the panel.
"""

from __future__ import annotations

import re

# The prompt asks for four backticks so a suggestion can quote code, but models
# normalize fences to three, so accept either. The ``next`` tag is what marks
# the block, so an ordinary code block is never mistaken for one.
_NEXT_BLOCK = re.compile(r"`{3,}[ \t]*next[ \t]*\r?\n(.*?)(?:`{3,}|\Z)", re.DOTALL | re.IGNORECASE)
MAX_STEPS = 2
MAX_LABEL_CHARS = 40
MAX_MESSAGE_CHARS = 300
VALID_TABS = frozenset({"component", "prompt", "ask"})
# label | tab | message
_FIELDS_PER_LINE = 3


def _parse_line(line: str) -> dict[str, str] | None:
    """One ``label | tab | message`` line, or None when it doesn't fit the shape."""
    parts = [part.strip() for part in line.lstrip("-*• \t").split("|")]
    if len(parts) != _FIELDS_PER_LINE:
        return None
    label, tab, message = parts
    tab = tab.lower()
    if tab not in VALID_TABS:
        return None
    if not label or not message:
        return None
    if len(label) > MAX_LABEL_CHARS or len(message) > MAX_MESSAGE_CHARS:
        return None
    return {"label": label, "mode": tab, "message": message}


def extract_next_steps(text: str) -> tuple[str, list[dict[str, str]]]:
    """Split an answer into the answer itself and its follow-up suggestions.

    Returns the text without the block and at most ``MAX_STEPS`` suggestions.
    A missing or malformed block simply yields no suggestions.
    """
    if not text:
        return text, []
    matches = list(_NEXT_BLOCK.finditer(text))
    if not matches:
        return text, []
    # The last block: an answer that explains the format would quote it first.
    match = matches[-1]
    steps: list[dict[str, str]] = []
    for line in match.group(1).splitlines():
        if not line.strip():
            continue
        step = _parse_line(line)
        if step:
            steps.append(step)
        if len(steps) == MAX_STEPS:
            break
    cleaned = (text[: match.start()] + text[match.end() :]).rstrip()
    return cleaned, steps

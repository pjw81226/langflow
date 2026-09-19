"""Code and data extraction from markdown responses."""

import json
import logging
import re

logger = logging.getLogger(__name__)

PYTHON_CODE_BLOCK_PATTERN = r"```python\s*([\s\S]*?)```"
FLOW_JSON_BLOCK_PATTERN = r"```flow_json\s*([\s\S]*?)```"
GENERIC_CODE_BLOCK_PATTERN = r"```\s*([\s\S]*?)```"
UNCLOSED_PYTHON_BLOCK_PATTERN = r"```python\s*([\s\S]*)$"
UNCLOSED_GENERIC_BLOCK_PATTERN = r"```\s*([\s\S]*)$"
ANY_CODE_BLOCK_PATTERN = r"```[\s\S]*?```|```[\s\S]*$"


def extract_python_code(text: str) -> str | None:
    """Extract Python code from markdown code blocks.

    Handles both closed (```python ... ```) and unclosed blocks.
    Returns the first code block that appears to be a Langflow component.
    """
    matches = _find_code_blocks(text)
    if not matches:
        return None

    return _find_component_code(matches) or matches[0].strip()


def _find_code_blocks(text: str) -> list[str]:
    """Find all code blocks in text, handling both closed and unclosed blocks."""
    matches = re.findall(PYTHON_CODE_BLOCK_PATTERN, text, re.IGNORECASE)
    if matches:
        return matches

    matches = re.findall(GENERIC_CODE_BLOCK_PATTERN, text)
    if matches:
        return matches

    return _find_unclosed_code_block(text)


def _find_unclosed_code_block(text: str) -> list[str]:
    """Handle LLM responses that don't close the code block with ```."""
    for pattern in [UNCLOSED_PYTHON_BLOCK_PATTERN, UNCLOSED_GENERIC_BLOCK_PATTERN]:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            code = match.group(1).rstrip("`").strip()
            return [code] if code else []

    return []


def _find_component_code(matches: list[str]) -> str | None:
    """Find the first match that looks like a Langflow component."""
    for match in matches:
        if "class " in match and "Component" in match:
            return match.strip()
    return None


# Alias for backward compatibility
extract_component_code = extract_python_code


def strip_component_code(text: str) -> str:
    """The reply without its code blocks: the explanation the panel shows above the card."""
    stripped = re.sub(ANY_CODE_BLOCK_PATTERN, "", text or "")
    return re.sub(r"\n{3,}", "\n\n", stripped).strip()


# A fenced block tagged ``prompt``. The closing fence must repeat the opening one,
# so a four-backtick block can hold ordinary three-backtick code blocks.
_PROMPT_BLOCK_RE = re.compile(
    r"^(?P<fence>`{3,})[ \t]*prompt[ \t]*\n(?P<body>.*?)\n(?P=fence)[ \t]*$", re.DOTALL | re.MULTILINE
)
_UNCLOSED_PROMPT_BLOCK_RE = re.compile(r"^(?P<fence>`{3,})[ \t]*prompt[ \t]*\n(?P<body>.*)\Z", re.DOTALL | re.MULTILINE)
_ANY_FENCED_BLOCK_RE = re.compile(
    r"^(?P<fence>`{3,})[ \t]*(?P<tag>[\w-]*)[ \t]*\n(?P<body>.*?)\n(?P=fence)[ \t]*$", re.DOTALL | re.MULTILINE
)
# Tags a model sometimes uses for plain prose when it forgets the ``prompt`` tag.
_PLAIN_TEXT_TAGS = frozenset({"", "text", "txt", "markdown", "md"})


def _tidy(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_prompt_block(text: str) -> tuple[str | None, str]:
    """Split a prompt writer reply into ``(instructions, explanation)``.

    The instructions are the last block tagged ``prompt``. An unclosed block runs
    to the end of the reply. When no block is tagged, a single block tagged as
    plain text is accepted. ``instructions`` is None when the reply holds none,
    for example a question back to the user.
    """
    text = text or ""
    closed = list(_PROMPT_BLOCK_RE.finditer(text))
    if closed:
        body = closed[-1].group("body")
        rest = _PROMPT_BLOCK_RE.sub("", text)
    elif unclosed := _UNCLOSED_PROMPT_BLOCK_RE.search(text):
        body = re.sub(r"\n?`{3,}\s*\Z", "", unclosed.group("body"))
        rest = text[: unclosed.start()]
    else:
        blocks = list(_ANY_FENCED_BLOCK_RE.finditer(text))
        if len(blocks) != 1 or blocks[0].group("tag").lower() not in _PLAIN_TEXT_TAGS:
            return None, text.strip()
        body = blocks[0].group("body")
        rest = text[: blocks[0].start()] + text[blocks[0].end() :]
    body = body.strip()
    return (body or None), _tidy(rest)


def escape_template_braces(text: str) -> str:
    """Double every single curly brace so a LangChain prompt template reads it literally.

    Braces that are already doubled stay as they are.
    """
    return re.sub(
        r"\{\{|\}\}|\{|\}", lambda match: match.group(0) if match.group(0) in {"{{", "}}"} else match.group(0) * 2, text
    )


def extract_flow_json(text: str) -> dict | None:
    """Extract flow JSON from a ```flow_json code block in the response.

    The BuildFlowFromSpec tool instructs the agent to include the built
    flow data in a ```flow_json block so the assistant service can detect
    it and send a flow_preview event to the frontend.
    """
    match = re.search(FLOW_JSON_BLOCK_PATTERN, text, re.IGNORECASE)
    if not match:
        return None
    raw = match.group(1).strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning("Found ```flow_json``` block but JSON parsing failed: %s", e)
        return None

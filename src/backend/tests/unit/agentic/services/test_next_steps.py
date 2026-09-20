"""The Ask answer's follow-up block: what survives parsing and what is dropped."""

from langflow.agentic.services.next_steps import extract_next_steps


def test_no_block_leaves_the_answer_alone():
    text = "Connect the file to the Agent.\n\nSource: [Files](https://example.com)"
    assert extract_next_steps(text) == (text, [])


def test_parses_label_tab_and_message():
    text = (
        "Add a Read File component.\n\n"
        "Source: [Files](https://example.com)\n\n"
        "````next\n"
        "Write the component | component | Create a component that reads a CSV and returns rows\n"
        "Ask about tools | ask | How do I connect it to the Agent as a tool?\n"
        "````\n"
    )
    answer, steps = extract_next_steps(text)
    assert "````" not in answer
    assert answer.endswith("Source: [Files](https://example.com)")
    assert steps == [
        {
            "label": "Write the component",
            "mode": "component",
            "message": "Create a component that reads a CSV and returns rows",
        },
        {
            "label": "Ask about tools",
            "mode": "ask",
            "message": "How do I connect it to the Agent as a tool?",
        },
    ]


def test_keeps_at_most_two_suggestions():
    text = "Answer.\n\n````next\na | ask | one\nb | ask | two\nc | ask | three\n````"
    _, steps = extract_next_steps(text)
    assert [step["label"] for step in steps] == ["a", "b"]


def test_accepts_list_markers_and_an_unclosed_block():
    text = "Answer.\n\n````next\n- Test the flow | ask | Why did the test fail?\n"
    answer, steps = extract_next_steps(text)
    assert answer == "Answer."
    assert steps == [{"label": "Test the flow", "mode": "ask", "message": "Why did the test fail?"}]


def test_drops_lines_that_do_not_fit_the_shape():
    text = (
        "Answer.\n\n"
        "````next\n"
        "no pipes at all\n"
        "label | playground | unknown tab\n"
        "label | ask |\n"
        f"{'x' * 41} | ask | label too long\n"
        "Good one | prompt | Write instructions for the agent\n"
        "````"
    )
    _, steps = extract_next_steps(text)
    assert steps == [{"label": "Good one", "mode": "prompt", "message": "Write instructions for the agent"}]


def test_uses_the_last_block_when_the_answer_quotes_the_format():
    text = "Answer.\n\n````next\nquoted | ask | example\n````\n\nMore.\n\n````next\nreal | ask | the real one\n````"
    answer, steps = extract_next_steps(text)
    assert steps == [{"label": "real", "mode": "ask", "message": "the real one"}]
    assert answer.count("````next") == 1


def test_accepts_a_three_backtick_fence():
    """Models normalize fences to three backticks whatever the prompt asks for."""
    text = "Answer.\n\n```next\n파일 질문 | ask | 업로드한 파일을 요약해 줘.\n```"
    answer, steps = extract_next_steps(text)
    assert answer == "Answer."
    assert steps == [{"label": "파일 질문", "mode": "ask", "message": "업로드한 파일을 요약해 줘."}]


def test_leaves_an_ordinary_code_block_alone():
    text = "Answer.\n\n```python\nprint('next')\n```"
    assert extract_next_steps(text) == (text, [])


def test_empty_answer_is_safe():
    assert extract_next_steps("") == ("", [])

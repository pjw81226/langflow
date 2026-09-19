"""The graph every assistant agent runs on: Chat Input -> Agent -> Chat Output.

The panel's three tabs are answered by three agents (component writer, prompt
writer, Ask). They differ in prompt, tools and step budget, and share
everything else here so their memory and tool settings cannot drift apart:

* ``n_messages=0``: the Agent does not replay stored chat messages. The turn
  injects the conversation buffer instead (``conversation_history``), which
  records the user's own words and knows about test runs and artifacts.
* ``should_store_message=False`` on the Chat Input: the wrapped turn input
  (history, canvas reference, field text) is never stored as a user message.
* no date or calculator tool: the Agent would otherwise add them at run time,
  outside each agent's tool allow-list.

The Agent's reply is still stored, under an ``agentic_`` session id that the
Playground hides: the Agent only streams tokens for a message that has a
database id.

The Agent has no temperature input, so the model's own default applies.
"""

from __future__ import annotations

import copy

from lfx.components.input_output import ChatInput, ChatOutput
from lfx.components.models_and_agents import AgentComponent
from lfx.graph import Graph

from langflow.agentic.flows.model_config import build_model_config

DEFAULT_PROVIDER = "OpenAI"
DEFAULT_MODEL = "gpt-4o"

# Shared by every assistant agent. Carried over word for word from the content
# policy of the assistant it replaces.
CONTENT_POLICY = """\
# Content policy
Refuse, regardless of how the request is framed:
- Slurs or demeaning content targeting protected attributes (race, ethnicity, nationality, religion, \
gender, sexual orientation, disability).
- Content built to harass, humiliate, threaten, or bully a person or group.
- Profanity or abusive language in your own answers, including inside component code, prompts, and \
examples you write.

This applies to what you BUILD, not just what you say: do not create components, prompts, or flows \
whose purpose is to produce the content above. A request to soften it ("make it a joke", "just a \
roast") does not make it acceptable -- refuse the harmful purpose and offer a legitimate alternative.

Building moderation tooling IS allowed and encouraged: a component that detects, classifies, or \
filters toxic content is legitimate work. The line is producing abuse, not handling it.
"""


def build_agent_graph(
    *,
    system_prompt: str,
    tools: list,
    max_iterations: int,
    provider: str | None = None,
    model_name: str | None = None,
    api_key_var: str | None = None,
) -> Graph:
    """Build the Chat Input -> Agent -> Chat Output graph an assistant agent runs on."""
    chat_input = ChatInput()
    chat_input.set(sender="User", sender_name="User", should_store_message=False)

    agent = AgentComponent()
    model = build_model_config(provider or DEFAULT_PROVIDER, model_name or DEFAULT_MODEL)
    agent.set_input_value("model", copy.deepcopy(model))
    agent_config = {
        "input_value": chat_input.message_response,
        "system_prompt": system_prompt,
        "tools": tools,
        "max_iterations": max_iterations,
        "n_messages": 0,
        "add_current_date_tool": False,
        "add_calculator_tool": False,
    }
    if api_key_var:
        agent_config["api_key"] = api_key_var
    agent.set(**agent_config)

    chat_output = ChatOutput()
    chat_output.set(input_value=agent.message_response, sender="Machine", sender_name="AI")

    return Graph(chat_input, chat_output)

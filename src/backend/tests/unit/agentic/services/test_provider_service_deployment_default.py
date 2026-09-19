"""A deployment can name the assistant's default model (LANGFLOW_ASSISTANT_DEFAULT_MODEL).

Without it the default follows the built-in preference order, and the panel picks
the newest model in the catalog, which is usually the provider's most expensive.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from langflow.agentic.services import provider_service
from langflow.agentic.services.provider_service import get_default_model

CATALOG = ["gpt-big", "gpt-5.4", "gpt-mid", "gpt-small"]


@pytest.fixture
def _catalog():
    with (
        patch.object(provider_service, "get_unified_models_detailed", return_value=[]),
        patch.object(provider_service, "list_installed_tool_calling_models", return_value=[]),
        patch.object(provider_service, "_catalog_model_names", return_value=CATALOG),
    ):
        yield


def _configure(monkeypatch, value: str) -> None:
    from lfx.services.deps import get_settings_service

    monkeypatch.setattr(get_settings_service().settings, "assistant_default_model", value)


@pytest.mark.usefixtures("_catalog")
def test_the_built_in_preference_order_applies_when_nothing_is_configured(monkeypatch):
    _configure(monkeypatch, "")

    assert get_default_model("OpenAI") == "gpt-5.4"


@pytest.mark.usefixtures("_catalog")
def test_the_configured_model_wins_while_the_provider_offers_it(monkeypatch):
    _configure(monkeypatch, "OpenAI:gpt-mid")

    assert get_default_model("OpenAI") == "gpt-mid"


@pytest.mark.usefixtures("_catalog")
def test_a_configured_model_the_provider_does_not_offer_is_ignored(monkeypatch):
    _configure(monkeypatch, "OpenAI:gpt-retired")

    assert get_default_model("OpenAI") == "gpt-5.4"


@pytest.mark.usefixtures("_catalog")
def test_a_model_configured_for_another_provider_does_not_leak(monkeypatch):
    _configure(monkeypatch, "Anthropic:gpt-mid")

    assert get_default_model("OpenAI") == "gpt-5.4"


def test_a_live_provider_only_gets_the_configured_model_if_it_is_installed(monkeypatch):
    _configure(monkeypatch, "Ollama:llama3.1:70b")
    with (
        patch.object(provider_service, "get_unified_models_detailed", return_value=[]),
        patch.object(
            provider_service, "list_installed_tool_calling_models", return_value=["qwen3:32b", "llama3.1:70b"]
        ),
    ):
        assert get_default_model("Ollama", user_id="u1") == "llama3.1:70b"
    with (
        patch.object(provider_service, "get_unified_models_detailed", return_value=[]),
        patch.object(provider_service, "list_installed_tool_calling_models", return_value=["qwen3:32b"]),
    ):
        assert get_default_model("Ollama", user_id="u1") == "qwen3:32b"


def test_the_gpt_5_6_family_is_in_the_static_catalog():
    """Offline installs never see models.dev, so the family has to be listed here."""
    from lfx.base.models.openai_constants import OPENAI_MODELS_DETAILED

    names = {model["name"] for model in OPENAI_MODELS_DETAILED}

    assert {"gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"} <= names

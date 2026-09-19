"""A Component turn is refused up front when the user could never add the result.

The panel's Add to canvas button calls ``POST /api/v1/custom_component``, which
refuses custom code when it is disabled, admin-only for a non-superuser, or
called with external credentials that may not create. The Component tab applies
the same rules before any model runs, so a user never gets a component that
passed every check and is then refused.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from langflow.agentic.api import router as assistant_router
from langflow.agentic.api.router import _require_component_creation_allowed
from langflow.agentic.api.schemas import AssistantRequest
from lfx.services.deps import get_settings_service

_ROUTER = "langflow.agentic.api.router"


@pytest.fixture
def settings(monkeypatch):
    current = get_settings_service().settings
    monkeypatch.setattr(current, "allow_custom_components", True)
    monkeypatch.setattr(current, "custom_component_admin_only", False)
    return current


def _user(*, superuser: bool = False):
    return SimpleNamespace(id=uuid4(), is_superuser=superuser)


def test_should_allow_a_regular_user_by_default(settings):  # noqa: ARG001
    _require_component_creation_allowed(_user())


def test_should_refuse_when_custom_components_are_disabled(settings, monkeypatch):
    monkeypatch.setattr(settings, "allow_custom_components", False)

    with pytest.raises(HTTPException) as refused:
        _require_component_creation_allowed(_user(superuser=True))

    assert refused.value.status_code == 403
    assert "disabled" in refused.value.detail


def test_should_refuse_a_non_admin_when_creation_is_admin_only(settings, monkeypatch):
    monkeypatch.setattr(settings, "custom_component_admin_only", True)

    with pytest.raises(HTTPException) as refused:
        _require_component_creation_allowed(_user())

    assert refused.value.status_code == 403
    assert "administrators" in refused.value.detail
    _require_component_creation_allowed(_user(superuser=True))


def test_should_refuse_external_credentials_that_may_not_create(settings):  # noqa: ARG001
    with (
        patch(f"{_ROUTER}.get_current_external_access_context", return_value=object()),
        patch(f"{_ROUTER}.external_access_allows", return_value=False),
        pytest.raises(HTTPException) as refused,
    ):
        _require_component_creation_allowed(_user(superuser=True))

    assert refused.value.status_code == 403


@pytest.mark.parametrize(
    ("mode", "action", "refused"),
    [("component", None, True), ("component", "test_flow", False), ("prompt", None, False), ("ask", None, False)],
)
async def test_only_component_turns_are_checked(settings, monkeypatch, mode, action, refused):
    monkeypatch.setattr(settings, "allow_custom_components", False)
    access = AsyncMock(side_effect=RuntimeError("reached the flow lookup"))
    request = AssistantRequest(flow_id=str(uuid4()), input_value="hi", mode=mode, action=action)

    with patch(f"{_ROUTER}._validate_flow_access", access):
        if refused:
            with pytest.raises(HTTPException) as denied:
                await assistant_router.assist_stream(request, SimpleNamespace(), _user(), AsyncMock())
            assert denied.value.status_code == 403
            access.assert_not_awaited()
        else:
            with pytest.raises(RuntimeError, match="reached the flow lookup"):
                await assistant_router.assist_stream(request, SimpleNamespace(), _user(), AsyncMock())

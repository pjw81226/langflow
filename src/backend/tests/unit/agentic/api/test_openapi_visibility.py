"""Agentic routers must stay hidden from /openapi.json, and removed routes stay gone.

The assistant HTTP surfaces are internal. They are mounted with
``include_in_schema=False`` so they do not appear in the published OpenAPI
spec, Swagger UI, or generated SDKs.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from langflow.agentic.api.router import router as assistant_router
from langflow.agentic.api.sessions_router import router as sessions_router

KEPT_ROUTES = ("/agentic/assist/stream", "/agentic/check-config", "/agentic/sessions/reset")

# Routes of the assistant this one replaced. Nothing may serve them any more.
REMOVED_ROUTES = ("/agentic/assist", "/agentic/assist/run", "/agentic/execute/{flow_name}", "/agentic/files")


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(assistant_router)
    app.include_router(sessions_router)
    return app


def test_the_assistant_routes_are_hidden_from_the_schema():
    response = TestClient(_app()).get("/openapi.json")

    assert response.status_code == 200
    paths = response.json().get("paths", {})
    for route in (*KEPT_ROUTES, *REMOVED_ROUTES):
        assert route not in paths, f"{route} must not be in the OpenAPI schema"


def test_only_the_new_assistant_routes_are_mounted():
    mounted = {route.path for route in (*assistant_router.routes, *sessions_router.routes)}

    for route in KEPT_ROUTES:
        assert route in mounted
    for route in REMOVED_ROUTES:
        assert route not in mounted

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlencode

from jupyter_server.base.handlers import APIHandler
from tornado import web
from tornado.httpclient import AsyncHTTPClient, HTTPRequest


OPENAI_API_URL = "https://api.openai.com/v1/responses"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"


def _assistant_secret_file_path() -> str:
    configured = os.environ.get("SUGARPY_ASSISTANT_ENV_FILE", "").strip()
    if configured:
        return os.path.expanduser(configured)
    return os.path.expanduser("~/.config/sugarpy/assistant.env")


def _load_assistant_secret_values() -> dict[str, str]:
    values: dict[str, str] = {}
    path = _assistant_secret_file_path()
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    except FileNotFoundError:
        return values
    except OSError:
        return values
    return values


def _assistant_setting(name: str) -> str:
    env_value = os.environ.get(name, "").strip()
    if env_value:
        return env_value
    return _load_assistant_secret_values().get(name, "").strip()


def _load_assistant_server_config() -> dict[str, Any]:
    return {
        "model": _assistant_setting("SUGARPY_ASSISTANT_MODEL") or None,
        "providers": {
            "openai": bool(_assistant_setting("SUGARPY_ASSISTANT_OPENAI_API_KEY")),
            "gemini": bool(_assistant_setting("SUGARPY_ASSISTANT_GEMINI_API_KEY")),
        },
    }


class AssistantConfigHandler(APIHandler):
    @web.authenticated
    async def get(self) -> None:
        self.finish(_load_assistant_server_config())


class AssistantOpenAIProxyHandler(APIHandler):
    @web.authenticated
    async def post(self) -> None:
        api_key = _assistant_setting("SUGARPY_ASSISTANT_OPENAI_API_KEY")
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server OpenAI key is not configured."})
            return

        try:
            payload = self.get_json_body() or {}
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        payload["stream"] = False

        client = AsyncHTTPClient()
        response = await client.fetch(
            HTTPRequest(
                OPENAI_API_URL,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                body=json.dumps(payload),
                request_timeout=120,
                connect_timeout=20,
                follow_redirects=False,
            ),
            raise_error=False,
        )
        self.set_status(response.code or 502)
        self.set_header(
            "Content-Type",
            response.headers.get("Content-Type", "application/json"),
        )
        self.finish(response.body or b"")


class AssistantGeminiProxyHandler(APIHandler):
    @web.authenticated
    async def post(self, model: str) -> None:
        api_key = _assistant_setting("SUGARPY_ASSISTANT_GEMINI_API_KEY")
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server Gemini key is not configured."})
            return

        query = urlencode({"key": api_key})
        upstream_url = f"{GEMINI_API_ROOT}/models/{model}:generateContent?{query}"
        client = AsyncHTTPClient()
        response = await client.fetch(
            HTTPRequest(
                upstream_url,
                method="POST",
                headers={"Content-Type": "application/json"},
                body=self.request.body,
                request_timeout=120,
                connect_timeout=20,
                follow_redirects=False,
            ),
            raise_error=False,
        )
        self.set_status(response.code)
        self.set_header(
            "Content-Type",
            response.headers.get("Content-Type", "application/json"),
        )
        self.finish(response.body or b"")


def _jupyter_server_extension_points() -> list[dict[str, str]]:
    return [{"module": "sugarpy.server_extension"}]


def _load_jupyter_server_extension(server_app: Any) -> None:
    base_url = server_app.web_app.settings.get("base_url", "/")
    handlers = [
        (r"/sugarpy/assistant/config", AssistantConfigHandler),
        (r"/sugarpy/assistant/openai/responses", AssistantOpenAIProxyHandler),
        (r"/sugarpy/assistant/gemini/models/(.+):generateContent", AssistantGeminiProxyHandler),
    ]
    server_app.web_app.add_handlers(".*$", [(f"{base_url.rstrip('/')}{route}", handler) for route, handler in handlers])


load_jupyter_server_extension = _load_jupyter_server_extension

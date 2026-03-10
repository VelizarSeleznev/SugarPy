from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlencode

from jupyter_server.base.handlers import APIHandler
from tornado import web
from tornado.httpclient import AsyncHTTPClient, HTTPRequest


OPENAI_API_URL = "https://api.openai.com/v1/responses"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"


def _load_assistant_server_config() -> dict[str, Any]:
    return {
        "model": os.environ.get("SUGARPY_ASSISTANT_MODEL", "").strip() or None,
        "providers": {
            "openai": bool(os.environ.get("SUGARPY_ASSISTANT_OPENAI_API_KEY", "").strip()),
            "gemini": bool(os.environ.get("SUGARPY_ASSISTANT_GEMINI_API_KEY", "").strip()),
        },
    }


class AssistantConfigHandler(APIHandler):
    @web.authenticated
    async def get(self) -> None:
        self.finish(_load_assistant_server_config())


class AssistantOpenAIProxyHandler(APIHandler):
    @web.authenticated
    async def post(self) -> None:
        api_key = os.environ.get("SUGARPY_ASSISTANT_OPENAI_API_KEY", "").strip()
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server OpenAI key is not configured."})
            return

        client = AsyncHTTPClient()
        headers_started = False

        def header_callback(line: bytes) -> None:
            nonlocal headers_started
            text = line.decode("utf-8", errors="replace").strip()
            if not text:
                if not headers_started:
                    self.set_status(502)
                self.flush()
                return
            if text.startswith("HTTP/"):
                parts = text.split(" ", 2)
                status_code = 502
                if len(parts) > 1:
                    try:
                        status_code = int(parts[1])
                    except ValueError:
                        status_code = 502
                self.set_status(status_code)
                headers_started = True
                return
            if ":" not in text:
                return
            name, value = text.split(":", 1)
            lowered = name.lower()
            if lowered in {
                "content-type",
                "cache-control",
                "x-request-id",
                "openai-processing-ms",
            }:
                self.set_header(name, value.strip())

        async def streaming_callback(chunk: bytes) -> None:
            self.write(chunk)
            await self.flush()

        request = HTTPRequest(
            OPENAI_API_URL,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            body=self.request.body,
            request_timeout=120,
            connect_timeout=20,
            streaming_callback=streaming_callback,
            header_callback=header_callback,
            follow_redirects=False,
        )
        response = await client.fetch(request, raise_error=False)
        if not headers_started:
            self.set_status(response.code or 502)
            self.set_header(
                "Content-Type",
                response.headers.get("Content-Type", "application/json"),
            )
            if response.body:
                self.write(response.body)
        if not self._finished:
            self.finish()


class AssistantGeminiProxyHandler(APIHandler):
    @web.authenticated
    async def post(self, model: str) -> None:
        api_key = os.environ.get("SUGARPY_ASSISTANT_GEMINI_API_KEY", "").strip()
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

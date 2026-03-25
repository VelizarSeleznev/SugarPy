from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode

from tornado.httpclient import AsyncHTTPClient, HTTPRequest

from .config import GEMINI_API_ROOT, GROQ_API_ROOT, OPENAI_API_URL


async def proxy_openai_responses(api_key: str, payload: dict[str, Any]) -> tuple[int, str, bytes]:
    client = AsyncHTTPClient()
    response = await client.fetch(
        HTTPRequest(
            OPENAI_API_URL,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            body=json.dumps({**payload, "stream": False}),
            request_timeout=120,
            connect_timeout=20,
            follow_redirects=False,
        ),
        raise_error=False,
    )
    return response.code or 502, response.headers.get("Content-Type", "application/json"), response.body or b""


async def proxy_gemini_generate_content(api_key: str, model: str, body: bytes) -> tuple[int, str, bytes]:
    upstream_url = f"{GEMINI_API_ROOT}/models/{model}:generateContent?{urlencode({'key': api_key})}"
    client = AsyncHTTPClient()
    response = await client.fetch(
        HTTPRequest(
            upstream_url,
            method="POST",
            headers={"Content-Type": "application/json"},
            body=body,
            request_timeout=120,
            connect_timeout=20,
            follow_redirects=False,
        ),
        raise_error=False,
    )
    return response.code, response.headers.get("Content-Type", "application/json"), response.body or b""


async def proxy_groq_chat_completions(api_key: str, body: bytes) -> tuple[int, str, bytes]:
    client = AsyncHTTPClient()
    response = await client.fetch(
        HTTPRequest(
            f"{GROQ_API_ROOT}/chat/completions",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            body=body,
            request_timeout=120,
            connect_timeout=20,
            follow_redirects=False,
        ),
        raise_error=False,
    )
    return response.code or 502, response.headers.get("Content-Type", "application/json"), response.body or b""


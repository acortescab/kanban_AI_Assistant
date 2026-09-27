import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Local runs read the project-root .env; in Docker, compose's env_file already sets the variables.
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

MODEL = "qwen/qwen3.8-27b:free"
OPENROUTER_URL = os.getenv("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")


def get_openrouter_api_key() -> str:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY. Add it to the project .env file.")
    return api_key


def call_openrouter_messages(
    messages: list[dict[str, str]], response_format: dict | None = None
) -> str:
    api_key = get_openrouter_api_key()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8000",
        "X-Title": "Kanban AI Assistant",
    }
    payload = {
        "model": MODEL,
        "messages": messages,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    try:
        response = httpx.post(
            OPENROUTER_URL,
            headers=headers,
            json=payload,
            # A 27B model on a free shared pool routinely takes over a minute to answer.
            timeout=120.0,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 429:
            raise RuntimeError(
                "OpenRouter is rate limited right now. Please try again in a moment."
            ) from exc
        raise RuntimeError(f"OpenRouter call failed: {exc}") from exc
    except httpx.ConnectTimeout as exc:
        raise RuntimeError(f"Could not reach OpenRouter: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise RuntimeError(
            "OpenRouter did not respond within 120 seconds. Please try again."
        ) from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Could not reach OpenRouter: {exc}") from exc

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("OpenRouter response did not include any choices.")

    message = choices[0].get("message", {})
    content = message.get("content")
    if isinstance(content, list):
        return "".join(
            part.get("text", "")
            if isinstance(part, dict)
            else str(part)
            for part in content
        )
    if not isinstance(content, str):
        raise ValueError("OpenRouter response content was not a string.")

    return content


def call_openrouter(prompt: str) -> str:
    return call_openrouter_messages([{"role": "user", "content": prompt}])

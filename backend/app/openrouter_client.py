import os
from pathlib import Path

import httpx

MODEL = "qwen/qwen3.8-27b:free"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _load_dotenv_if_present() -> None:
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip("\"'")


_load_dotenv_if_present()


def get_openrouter_api_key() -> str:
    _load_dotenv_if_present()
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("Missing OPENROUTER_API_KEY. Add it to the project .env file.")
    return api_key


def call_openrouter_messages(messages: list[dict[str, str]]) -> str:
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

    response = httpx.post(
        OPENROUTER_URL,
        headers=headers,
        json=payload,
        timeout=30.0,
    )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 429:
            raise RuntimeError(
                "OpenRouter is rate limited right now. Please try again in a moment."
            ) from exc
        raise RuntimeError(f"OpenRouter call failed: {exc}") from exc

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

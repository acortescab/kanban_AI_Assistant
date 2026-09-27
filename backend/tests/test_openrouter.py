import httpx
import pytest

from app.openrouter_client import call_openrouter_messages

REQUEST = httpx.Request("POST", "https://openrouter.test")
HI = [{"role": "user", "content": "hi"}]


def respond_with(monkeypatch, status_code=200, body=None, error=None) -> dict:
    """Fakes OpenRouter with a key set; returns what the client posted."""
    captured = {}

    def fake_post(url, *, headers=None, json=None, timeout=None):
        captured.update(url=url, headers=headers, json=json)
        if error is not None:
            raise error
        return httpx.Response(status_code, json=body, request=REQUEST)

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr("app.openrouter_client.httpx.post", fake_post)
    return captured


@pytest.fixture
def client(demo):
    """The connectivity check spends API credits, so it needs a signed-in user."""
    return demo


# --- The /api/ai/test route --------------------------------------------------


def test_openrouter_test_route_requires_a_prompt(client):
    response = client.post("/api/ai/test", json={"prompt": "  "})

    assert response.status_code == 400


def test_openrouter_test_route_requires_api_key(monkeypatch, client):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    response = client.post("/api/ai/test", json={"prompt": "2 + 2"})

    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_openrouter_network_error_returns_503(monkeypatch, client):
    respond_with(monkeypatch, error=httpx.ConnectTimeout("timed out"))

    response = client.post("/api/ai/test", json={"prompt": "2 + 2"})

    assert response.status_code == 503
    assert "Could not reach OpenRouter" in response.json()["detail"]


def test_openrouter_test_route_returns_model_response(monkeypatch, client):
    captured = respond_with(monkeypatch, body={"choices": [{"message": {"content": "4"}}]})

    response = client.post("/api/ai/test", json={"prompt": "2 + 2"})

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["response"] == "4"
    assert captured["json"]["model"] == "qwen/qwen3.8-27b:free"
    assert "Authorization" in captured["headers"]


# --- Client error handling, called directly ------------------------------------


def test_response_format_is_sent_when_given(monkeypatch):
    captured = respond_with(monkeypatch, body={"choices": [{"message": {"content": "ok"}}]})

    call_openrouter_messages(HI, response_format={"type": "json_object"})

    assert captured["json"]["response_format"] == {"type": "json_object"}


@pytest.mark.parametrize(
    ("status_code", "message"),
    [(429, "rate limited"), (500, "OpenRouter call failed")],
)
def test_http_errors_become_runtime_errors(monkeypatch, status_code, message):
    respond_with(monkeypatch, status_code=status_code, body={"error": "nope"})

    with pytest.raises(RuntimeError, match=message):
        call_openrouter_messages(HI)


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (httpx.ReadTimeout("slow"), "did not respond within 120 seconds"),
        (httpx.ConnectError("refused"), "Could not reach OpenRouter"),
    ],
)
def test_network_errors_become_runtime_errors(monkeypatch, error, message):
    respond_with(monkeypatch, error=error)

    with pytest.raises(RuntimeError, match=message):
        call_openrouter_messages(HI)


def test_content_parts_are_joined(monkeypatch):
    respond_with(
        monkeypatch,
        body={"choices": [{"message": {"content": [{"text": "Hello "}, "world"]}}]},
    )

    assert call_openrouter_messages(HI) == "Hello world"


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"choices": []}, "did not include any choices"),
        ({"choices": [{"message": {"content": None}}]}, "was not a string"),
    ],
)
def test_unusable_responses_raise_value_errors(monkeypatch, body, message):
    respond_with(monkeypatch, body=body)

    with pytest.raises(ValueError, match=message):
        call_openrouter_messages(HI)

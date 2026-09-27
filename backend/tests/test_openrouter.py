import httpx
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_openrouter_test_route_requires_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    response = client.post("/api/ai/test", json={"prompt": "2 + 2"})

    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


def test_openrouter_network_error_returns_503(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def failing_post(*_args, **_kwargs):
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr("app.openrouter_client.httpx.post", failing_post)

    response = client.post("/api/ai/test", json={"prompt": "2 + 2"})

    assert response.status_code == 503
    assert "Could not reach OpenRouter" in response.json()["detail"]


def test_openrouter_test_route_returns_model_response(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    class FakeResponse:
        def __init__(self):
            self.status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [{
                    "message": {
                        "content": "4"
                    }
                }]
            }

    captured = {}

    def fake_post(url, *, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("app.openrouter_client.httpx.post", fake_post)

    response = client.post("/api/ai/test", json={"prompt": "2 + 2"})

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["response"] == "4"
    assert captured["json"]["model"] == "qwen/qwen3.8-27b:free"
    assert "Authorization" in captured["headers"]

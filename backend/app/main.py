from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.ai_flow import generate_structured_ai_response
from app.database import init_database
from app.openrouter_client import call_openrouter
from app.schemas import AIChatRequestModel, AIChatResponseModel, BoardDataModel
from app.service import get_board_record, save_board_record

app = FastAPI(title="Kanban AI Assistant")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_CANDIDATES = [
    Path(__file__).resolve().parent / "static",
    PROJECT_ROOT / "frontend" / "out",
]

STATIC_DIR = next(
    (
        candidate
        for candidate in STATIC_CANDIDATES
        if candidate.exists() and (candidate / "index.html").exists()
    ),
    None,
)

if STATIC_DIR is not None:
    app.mount("/_next", StaticFiles(directory=STATIC_DIR / "_next"), name="next-assets")

init_database()


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/board")
def get_board() -> dict[str, object]:
    return get_board_record().model_dump()


@app.put("/api/board")
def save_board(board: BoardDataModel) -> dict[str, object]:
    return save_board_record(board).model_dump()


@app.post("/api/ai/test")
def ai_test(payload: dict[str, str]) -> dict[str, object]:
    prompt = payload.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    try:
        response = call_openrouter(prompt)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive safety net
        raise HTTPException(
            status_code=503,
            detail=f"OpenRouter call failed: {exc}",
        ) from exc

    return {"ok": True, "response": response, "model": "qwen/qwen3.8-27b:free"}


@app.post("/api/ai/chat", response_model=AIChatResponseModel)
def ai_chat(request: AIChatRequestModel) -> AIChatResponseModel:
    try:
        response = generate_structured_ai_response(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive safety net
        raise HTTPException(
            status_code=503,
            detail=f"OpenRouter call failed: {exc}",
        ) from exc

    return response


@app.get("/")
def read_root() -> FileResponse:
    if STATIC_DIR is None or not (STATIC_DIR / "index.html").exists():
        raise FileNotFoundError("Frontend build is not available")
    return FileResponse(STATIC_DIR / "index.html")

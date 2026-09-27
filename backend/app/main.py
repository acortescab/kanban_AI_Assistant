from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from app.ai_flow import generate_structured_ai_response
from app.database import init_database
from app.openrouter_client import MODEL, call_openrouter
from app.schemas import AIChatRequestModel, AIChatResponseModel, BoardDataModel
from app.service import get_board_record, save_board_record

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_CANDIDATES = [
    Path(__file__).resolve().parent / "static",
    PROJECT_ROOT / "frontend" / "out",
]

STATIC_DIR = next(
    (candidate for candidate in STATIC_CANDIDATES if (candidate / "index.html").exists()),
    None,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_database()
    yield


app = FastAPI(title="Kanban AI Assistant", lifespan=lifespan)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/board")
def get_board() -> BoardDataModel:
    try:
        return get_board_record()
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.put("/api/board")
def save_board(board: BoardDataModel) -> BoardDataModel:
    return save_board_record(board)


@app.post("/api/ai/test")
def ai_test(payload: dict[str, str]) -> dict[str, object]:
    prompt = payload.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    try:
        response = call_openrouter(prompt)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"ok": True, "response": response, "model": MODEL}


@app.post("/api/ai/chat")
def ai_chat(request: AIChatRequestModel) -> AIChatResponseModel:
    try:
        return generate_structured_ai_response(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# Mounted last so the API routes above take precedence over the static site.
if STATIC_DIR is not None:
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")

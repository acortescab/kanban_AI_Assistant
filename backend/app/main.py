from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import init_database
from app.schemas import BoardDataModel
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


@app.get("/")
def read_root() -> FileResponse:
    if STATIC_DIR is None or not (STATIC_DIR / "index.html").exists():
        raise FileNotFoundError("Frontend build is not available")
    return FileResponse(STATIC_DIR / "index.html")

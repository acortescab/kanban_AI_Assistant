from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles

from app import service, users
from app.ai_flow import generate_structured_ai_response
from app.database import init_database
from app.openrouter_client import MODEL, call_openrouter
from app.schemas import (
    AccountDeleteModel,
    ActivityModel,
    AdminUserModel,
    AIChatRequestModel,
    AIChatResponseModel,
    BoardCreateModel,
    BoardDataModel,
    BoardMemberModel,
    BoardSummaryModel,
    BoardUpdateModel,
    LoginModel,
    MemberAddModel,
    PasswordChangeModel,
    ProfileUpdateModel,
    RegisterModel,
    RoleUpdateModel,
    UserModel,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_CANDIDATES = [
    Path(__file__).resolve().parent / "static",
    PROJECT_ROOT / "frontend" / "out",
]

STATIC_DIR = next(
    (candidate for candidate in STATIC_CANDIDATES if (candidate / "index.html").exists()),
    None,
)

SESSION_COOKIE = "kanban_session"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_database()
    yield


app = FastAPI(title="Kanban AI Assistant", lifespan=lifespan)


# --- Auth dependencies --------------------------------------------------------


def require_user(request: Request) -> UserModel:
    token = request.cookies.get(SESSION_COOKIE)
    user = users.get_session_user(token) if token else None
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return user


def require_admin(user: Annotated[UserModel, Depends(require_user)]) -> UserModel:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admins only.")
    return user


CurrentUser = Annotated[UserModel, Depends(require_user)]
AdminUser = Annotated[UserModel, Depends(require_admin)]


def start_session(response: Response, user: UserModel) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        users.create_session(user.id),
        max_age=int(users.SESSION_LIFETIME.total_seconds()),
        httponly=True,
        samesite="lax",
    )


def not_found(exc: LookupError) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


# --- Health -------------------------------------------------------------------


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


# --- Account ------------------------------------------------------------------


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterModel, response: Response) -> UserModel:
    try:
        user = users.create_user(payload.username, payload.password, payload.displayName)
    except users.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    start_session(response, user)
    return user


@app.post("/api/auth/login")
def login(payload: LoginModel, response: Response) -> UserModel:
    user = users.authenticate(payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    start_session(response, user)
    return user


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        users.delete_session(token)
    response.delete_cookie(SESSION_COOKIE)


@app.get("/api/auth/me")
def get_me(user: CurrentUser) -> UserModel:
    return user


@app.patch("/api/auth/me")
def update_me(payload: ProfileUpdateModel, user: CurrentUser) -> UserModel:
    return users.update_display_name(user.id, payload.displayName)


@app.post("/api/auth/password", status_code=204)
def change_password(payload: PasswordChangeModel, user: CurrentUser, request: Request) -> None:
    try:
        users.change_password(
            user.id,
            payload.currentPassword,
            payload.newPassword,
            keep_token=request.cookies[SESSION_COOKIE],
        )
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/auth/me", status_code=204)
def delete_me(payload: AccountDeleteModel, user: CurrentUser, response: Response) -> None:
    if not users.check_password(user.id, payload.password):
        raise HTTPException(status_code=400, detail="Password is incorrect.")
    if user.role == "admin" and sum(u.role == "admin" for u in users.list_users()) == 1:
        raise HTTPException(
            status_code=409, detail="You are the only admin. Make someone else an admin first."
        )
    users.delete_user(user.id)
    response.delete_cookie(SESSION_COOKIE)


# --- Boards -------------------------------------------------------------------


@app.get("/api/boards")
def list_boards(user: CurrentUser) -> list[BoardSummaryModel]:
    return service.list_boards(user.id)


@app.post("/api/boards", status_code=201)
def create_board(payload: BoardCreateModel, user: CurrentUser) -> BoardSummaryModel:
    return service.create_board(user.id, payload.title, payload.description)


@app.get("/api/boards/{board_id}")
def get_board_summary(board_id: str, user: CurrentUser) -> BoardSummaryModel:
    try:
        return service.get_board_summary(user.id, board_id)
    except LookupError as exc:
        raise not_found(exc) from exc


@app.patch("/api/boards/{board_id}")
def update_board(board_id: str, payload: BoardUpdateModel, user: CurrentUser) -> BoardSummaryModel:
    try:
        return service.update_board(user.id, board_id, payload.title, payload.description)
    except LookupError as exc:
        raise not_found(exc) from exc


@app.delete("/api/boards/{board_id}", status_code=204)
def delete_board(board_id: str, user: CurrentUser) -> None:
    try:
        service.delete_board(user.id, board_id)
    except LookupError as exc:
        raise not_found(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


# --- Members ------------------------------------------------------------------


@app.get("/api/boards/{board_id}/members")
def list_members(board_id: str, user: CurrentUser) -> list[BoardMemberModel]:
    try:
        return service.list_members(user.id, board_id)
    except LookupError as exc:
        raise not_found(exc) from exc


@app.post("/api/boards/{board_id}/members", status_code=201)
def add_member(board_id: str, payload: MemberAddModel, user: CurrentUser) -> list[BoardMemberModel]:
    try:
        return service.add_member(user.id, board_id, payload.username)
    except LookupError as exc:
        raise not_found(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except service.ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.delete("/api/boards/{board_id}/members/{member_id}", status_code=204)
def remove_member(board_id: str, member_id: str, user: CurrentUser) -> None:
    try:
        service.remove_member(user.id, board_id, member_id)
    except LookupError as exc:
        raise not_found(exc) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- Board data (versioned with ETag / If-Match) ------------------------------


def set_version(response: Response, version: int) -> None:
    response.headers["ETag"] = f'"{version}"'


def parse_if_match(if_match: str | None) -> int | None:
    """None means an unconditional save; otherwise the version the client last saw."""
    if if_match is None:
        return None
    try:
        return int(if_match.strip().removeprefix("W/").strip('"'))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid If-Match header.") from exc


@app.get("/api/boards/{board_id}/data")
def get_board_data(board_id: str, user: CurrentUser, response: Response) -> BoardDataModel:
    try:
        board, version = service.read_board(user.id, board_id)
    except LookupError as exc:
        raise not_found(exc) from exc
    set_version(response, version)
    return board


@app.put("/api/boards/{board_id}/data")
def save_board_data(
    board_id: str,
    board: BoardDataModel,
    user: CurrentUser,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> BoardDataModel:
    try:
        version = service.save_board_record(user.id, board_id, board, parse_if_match(if_match))
    except LookupError as exc:
        raise not_found(exc) from exc
    except service.VersionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except service.InvalidBoardError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    set_version(response, version)
    return board


@app.get("/api/boards/{board_id}/activity")
def list_activity(board_id: str, user: CurrentUser) -> list[ActivityModel]:
    try:
        return service.list_activity(user.id, board_id)
    except LookupError as exc:
        raise not_found(exc) from exc


@app.post("/api/boards/{board_id}/ai/chat")
def ai_chat(
    board_id: str, request: AIChatRequestModel, user: CurrentUser, response: Response
) -> AIChatResponseModel:
    try:
        reply, version = generate_structured_ai_response(request, user.id, board_id)
    except LookupError as exc:
        raise not_found(exc) from exc
    except service.VersionConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail="The board changed while the assistant was working, so its edit was not applied. Please ask again.",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    set_version(response, version)
    return reply


@app.post("/api/ai/test")
def ai_test(payload: dict[str, str], _user: CurrentUser) -> dict[str, object]:
    prompt = payload.get("prompt", "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    try:
        response = call_openrouter(prompt)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"ok": True, "response": response, "model": MODEL}


# --- Admin --------------------------------------------------------------------


@app.get("/api/admin/users")
def admin_list_users(_admin: AdminUser) -> list[AdminUserModel]:
    return users.list_users()


@app.patch("/api/admin/users/{user_id}")
def admin_set_role(user_id: str, payload: RoleUpdateModel, admin: AdminUser) -> UserModel:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role.")
    try:
        return users.set_role(user_id, payload.role)
    except LookupError as exc:
        raise not_found(exc) from exc


@app.delete("/api/admin/users/{user_id}", status_code=204)
def admin_delete_user(user_id: str, admin: AdminUser) -> None:
    if user_id == admin.id:
        raise HTTPException(
            status_code=400, detail="Delete your own account from account settings."
        )
    try:
        users.delete_user(user_id)
    except LookupError as exc:
        raise not_found(exc) from exc


# Mounted last so the API routes above take precedence over the static site.
if STATIC_DIR is not None:
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")

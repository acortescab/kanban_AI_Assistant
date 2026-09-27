import copy
import json
import threading

import pytest

from app import service
from app.database import get_connection
from tests.conftest import DATA, DEMO_BOARD, MEMBERS, fake_model, registered_client, user_id


@pytest.fixture
def shared(demo, alice):
    """board-1, owned by the demo user, shared with alice."""
    assert demo.post(MEMBERS, json={"username": "alice"}).status_code == 201
    return demo, alice


# --- Sharing -----------------------------------------------------------------


def test_owner_adds_a_member_by_username(demo, alice):
    response = demo.post(MEMBERS, json={"username": " ALICE "})

    assert response.status_code == 201
    assert [(m["username"], m["role"]) for m in response.json()] == [
        ("user", "owner"),
        ("alice", "member"),
    ]
    assert response.json()[1]["displayName"] == "Alice"


def test_a_member_sees_and_edits_the_shared_board(shared):
    demo, alice = shared

    boards = {board["id"]: board for board in alice.get("/api/boards").json()}
    assert boards[DEMO_BOARD.rsplit("/", 1)[1]]["isOwner"] is False
    assert boards["board-1"]["ownerName"] == "Demo User"
    assert len(boards) == 2  # alice's starter board plus the shared one

    data = alice.get(DATA).json()
    data["columns"][0]["title"] = "Edited by Alice"
    assert alice.put(DATA, json=data).status_code == 200
    assert demo.get(DATA).json()["columns"][0]["title"] == "Edited by Alice"

    assert alice.patch(DEMO_BOARD, json={"description": "Shared plan"}).status_code == 200


def test_summaries_show_ownership_and_member_count(shared):
    demo, _alice = shared

    board = demo.get(DEMO_BOARD).json()

    assert board["isOwner"] is True
    assert board["ownerName"] == "Demo User"
    assert board["memberCount"] == 1


def test_everyone_on_the_board_can_list_members(shared):
    demo, alice = shared

    assert alice.get(MEMBERS).json() == demo.get(MEMBERS).json()


def test_outsiders_cannot_see_members(demo, alice):
    bob = registered_client("bob")

    assert bob.get(MEMBERS).status_code == 404


def test_only_the_owner_can_share_or_delete(shared):
    _demo, alice = shared
    registered_client("bob")

    response = alice.post(MEMBERS, json={"username": "bob"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Only the board owner can do that."
    assert alice.delete(DEMO_BOARD).status_code == 403


@pytest.mark.parametrize(
    ("username", "status", "detail"),
    [
        ("nobody", 404, 'No user named "nobody".'),
        ("user", 409, "The owner already has access."),
    ],
)
def test_adding_unknown_or_owner_is_refused(demo, username, status, detail):
    response = demo.post(MEMBERS, json={"username": username})

    assert response.status_code == status
    assert response.json()["detail"] == detail


def test_adding_a_member_twice_is_refused(shared):
    demo, _alice = shared

    response = demo.post(MEMBERS, json={"username": "alice"})

    assert response.status_code == 409
    assert response.json()["detail"] == "That user is already a member."


def test_owner_removes_a_member(shared):
    demo, alice = shared

    assert demo.delete(f"{MEMBERS}/{user_id(alice)}").status_code == 204

    assert alice.get(DATA).status_code == 404
    assert [board["id"] for board in alice.get("/api/boards").json()] != ["board-1"]


def test_a_member_can_leave(shared):
    demo, alice = shared

    assert alice.delete(f"{MEMBERS}/{user_id(alice)}").status_code == 204

    assert alice.get(DATA).status_code == 404
    assert demo.get(DEMO_BOARD).json()["memberCount"] == 0


def test_a_member_cannot_remove_someone_else(shared):
    demo, _alice = shared
    bob = registered_client("bob")
    demo.post(MEMBERS, json={"username": "bob"})

    response = bob.delete(f"{MEMBERS}/{user_id(demo)}")
    assert response.status_code == 400  # the owner can never be removed

    alice_id = [m for m in demo.get(MEMBERS).json() if m["username"] == "alice"][0]["userId"]
    assert bob.delete(f"{MEMBERS}/{alice_id}").status_code == 403


def test_the_owner_cannot_leave_their_own_board(demo):
    response = demo.delete(f"{MEMBERS}/user-1")

    assert response.status_code == 400
    assert "owner" in response.json()["detail"]


def test_removing_someone_who_is_not_a_member_is_404(demo, alice):
    assert demo.delete(f"{MEMBERS}/{user_id(alice)}").status_code == 404


def test_deleting_a_shared_board_removes_access_for_members(shared):
    demo, alice = shared

    assert demo.delete(DEMO_BOARD).status_code == 204

    assert alice.get(DATA).status_code == 404
    with get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM board_members").fetchone()[0] == 0


def test_deleting_a_member_account_removes_their_memberships(shared):
    demo, alice = shared

    alice.request("DELETE", "/api/auth/me", json={"password": "password123"})

    assert demo.get(DEMO_BOARD).json()["memberCount"] == 0
    assert [m["username"] for m in demo.get(MEMBERS).json()] == ["user"]


def test_admin_deleting_an_owner_removes_boards_shared_with_others(demo, alice):
    alice_board = alice.get("/api/boards").json()[0]["id"]
    alice.post(f"/api/boards/{alice_board}/members", json={"username": "user"})
    assert demo.get(f"/api/boards/{alice_board}/data").status_code == 200

    assert demo.delete(f"/api/admin/users/{user_id(alice)}").status_code == 204

    assert demo.get(f"/api/boards/{alice_board}/data").status_code == 404


def test_member_routes_require_a_session(client):
    assert client.get(MEMBERS).status_code == 401
    assert client.post(MEMBERS, json={"username": "x"}).status_code == 401
    assert client.delete(f"{MEMBERS}/user-1").status_code == 401


# --- Versioned saves ---------------------------------------------------------


def test_reads_and_saves_report_the_board_version(demo):
    first = demo.get(DATA)
    assert first.headers["ETag"] == '"0"'

    saved = demo.put(DATA, json=first.json(), headers={"If-Match": '"0"'})

    assert saved.status_code == 200
    assert saved.headers["ETag"] == '"1"'
    assert demo.get(DATA).headers["ETag"] == '"1"'


def test_a_stale_save_is_refused_and_changes_nothing(shared):
    demo, alice = shared
    stale = alice.get(DATA).json()
    newer = copy.deepcopy(stale)
    newer["columns"][0]["title"] = "Demo's change"
    assert demo.put(DATA, json=newer, headers={"If-Match": '"0"'}).status_code == 200

    stale["columns"][1]["title"] = "Alice's stale change"
    response = alice.put(DATA, json=stale, headers={"If-Match": '"0"'})

    assert response.status_code == 409
    assert "changed by someone else" in response.json()["detail"]
    current = demo.get(DATA).json()
    assert current["columns"][0]["title"] == "Demo's change"
    assert current["columns"][1]["title"] == "Discovery"


def test_a_save_without_if_match_is_unconditional(demo):
    data = demo.get(DATA).json()
    demo.put(DATA, json=data)

    assert demo.put(DATA, json=data).headers["ETag"] == '"2"'


@pytest.mark.parametrize("header", ["W/\"0\"", "0"])
def test_if_match_accepts_weak_and_bare_versions(demo, header):
    response = demo.put(DATA, json=demo.get(DATA).json(), headers={"If-Match": header})

    assert response.status_code == 200


def test_a_malformed_if_match_is_rejected(demo):
    response = demo.put(DATA, json=demo.get(DATA).json(), headers={"If-Match": '"abc"'})

    assert response.status_code == 400


def test_concurrent_saves_from_the_same_version_cannot_both_win(demo):
    board, _version = service.read_board("user-1", "board-1")
    results = []
    start = threading.Barrier(2)

    def save(title):
        changed = board.model_copy(deep=True)
        changed.columns[0].title = title
        start.wait()
        try:
            results.append(service.save_board_record("user-1", "board-1", changed, expected_version=0))
        except service.VersionConflictError:
            results.append("conflict")

    threads = [threading.Thread(target=save, args=(title,)) for title in ("A", "B")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results, key=str) == [1, "conflict"]


# --- AI edits on shared and changing boards ---------------------------------


def test_the_ai_refuses_to_overwrite_an_edit_made_while_it_was_thinking(monkeypatch, shared):
    demo, alice = shared
    board = demo.get(DATA).json()
    ai_board = copy.deepcopy(board)
    ai_board["columns"][0]["title"] = "AI title"

    def slow_model(messages, response_format=None):
        # Someone edits the board while the model is still answering.
        edited = copy.deepcopy(board)
        edited["columns"][1]["title"] = "Edited meanwhile"
        assert alice.put(DATA, json=edited).status_code == 200
        return json.dumps({"response": "Renamed.", "board": ai_board})

    monkeypatch.setattr("app.ai_flow.call_openrouter_messages", slow_model)

    response = demo.post(f"{DEMO_BOARD}/ai/chat", json={"question": "Rename"})

    assert response.status_code == 409
    assert "changed while the assistant was working" in response.json()["detail"]
    current = demo.get(DATA).json()
    assert current["columns"][1]["title"] == "Edited meanwhile"
    assert current["columns"][0]["title"] == "Backlog"


def test_ai_replies_carry_the_board_version(monkeypatch, demo):
    board = demo.get(DATA).json()

    fake_model(monkeypatch, {"response": "Nothing to change.", "board": None})
    assert demo.post(f"{DEMO_BOARD}/ai/chat", json={"question": "Hi"}).headers["ETag"] == '"0"'

    fake_model(monkeypatch, {"response": "Changed.", "board": board})
    assert demo.post(f"{DEMO_BOARD}/ai/chat", json={"question": "Go"}).headers["ETag"] == '"1"'


def test_a_member_can_use_the_ai_on_a_shared_board(monkeypatch, shared):
    _demo, alice = shared
    fake_model(monkeypatch, {"response": "Hi", "board": None})

    assert alice.post(f"{DEMO_BOARD}/ai/chat", json={"question": "Hi"}).status_code == 200

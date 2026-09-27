import sqlite3

import pytest

from app.database import get_connection, init_database
from tests.conftest import DATA, DEMO_BOARD


def card(card_id, title="A card", **fields):
    return {
        "id": card_id,
        "title": title,
        "details": "",
        "priority": "medium",
        "dueDate": None,
        "labels": [],
        "assigneeId": None,
        **fields,
    }


def make_board(columns=None, cards=None):
    """A board in the full response shape. columns: list of (id, title, cardIds)."""
    columns = columns or [
        ("col-backlog", "Backlog", []),
        ("col-discovery", "Discovery", []),
        ("col-progress", "In Progress", []),
        ("col-review", "Review", []),
        ("col-done", "Done", []),
    ]
    return {
        "columns": [
            {"id": column_id, "title": title, "cardIds": card_ids}
            for column_id, title, card_ids in columns
        ],
        "cards": cards or {},
    }


# --- Access control ----------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/boards"),
        ("post", "/api/boards"),
        ("get", DEMO_BOARD),
        ("patch", DEMO_BOARD),
        ("delete", DEMO_BOARD),
        ("get", DATA),
        ("put", DATA),
        ("post", f"{DEMO_BOARD}/ai/chat"),
        ("post", "/api/ai/test"),
    ],
)
def test_board_routes_require_a_session(client, method, path):
    response = client.request(method.upper(), path, json={})

    assert response.status_code == 401


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", DEMO_BOARD, None),
        ("patch", DEMO_BOARD, {"title": "Mine now"}),
        ("delete", DEMO_BOARD, None),
        ("get", DATA, None),
        ("put", DATA, make_board()),
    ],
)
def test_other_users_boards_look_missing(alice, demo, method, path, body):
    response = alice.request(method.upper(), path, json=body)

    assert response.status_code == 404
    assert response.json()["detail"] == "Board not found"
    assert len(demo.get(DATA).json()["cards"]) == 8


def test_board_lists_are_per_user(demo, alice):
    assert [board["id"] for board in demo.get("/api/boards").json()] == ["board-1"]
    assert [board["title"] for board in alice.get("/api/boards").json()] == ["My first board"]


# --- Board metadata ----------------------------------------------------------


def test_board_list_includes_summary_fields(demo):
    [board] = demo.get("/api/boards").json()

    assert board["id"] == "board-1"
    assert board["title"] == "Project Board"
    assert board["description"] == ""
    assert board["cardCount"] == 8
    assert board["createdAt"] and board["updatedAt"]


def test_create_board_starts_with_default_columns_and_no_cards(demo):
    response = demo.post("/api/boards", json={"title": " Launch ", "description": "Q4 launch"})

    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "Launch"
    assert created["description"] == "Q4 launch"
    assert created["cardCount"] == 0

    data = demo.get(f"/api/boards/{created['id']}/data").json()
    assert [column["title"] for column in data["columns"]] == [
        "Backlog",
        "Discovery",
        "In Progress",
        "Review",
        "Done",
    ]
    assert len({column["id"] for column in data["columns"]}) == 5
    assert data["cards"] == {}
    assert [board["id"] for board in demo.get("/api/boards").json()] == ["board-1", created["id"]]


@pytest.mark.parametrize(
    "payload",
    [{"title": ""}, {"title": "x" * 101}, {"title": "ok", "description": "x" * 501}, {}],
)
def test_create_board_validates_input(demo, payload):
    assert demo.post("/api/boards", json=payload).status_code == 422


def test_rename_and_describe_a_board(demo):
    response = demo.patch(DEMO_BOARD, json={"title": "Renamed"})
    assert response.status_code == 200
    assert response.json()["title"] == "Renamed"
    assert response.json()["description"] == ""

    response = demo.patch(DEMO_BOARD, json={"description": "What we ship"})
    assert response.json()["title"] == "Renamed"
    assert response.json()["description"] == "What we ship"
    assert demo.get(DEMO_BOARD).json()["description"] == "What we ship"


def test_rename_rejects_an_empty_title(demo):
    assert demo.patch(DEMO_BOARD, json={"title": ""}).status_code == 422


def test_delete_board_removes_its_columns_and_cards(demo):
    assert demo.delete(DEMO_BOARD).status_code == 204

    assert demo.get(DEMO_BOARD).status_code == 404
    assert demo.get("/api/boards").json() == []
    with get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM board_columns").fetchone()[0] == 0


def test_a_deleted_demo_board_is_not_reseeded_on_restart(demo):
    demo.delete(DEMO_BOARD)

    init_database()

    assert demo.get("/api/boards").json() == []


# --- Board data --------------------------------------------------------------


def test_seeded_board_data(demo):
    data = demo.get(DATA).json()

    assert [column["id"] for column in data["columns"]] == [
        "col-backlog",
        "col-discovery",
        "col-progress",
        "col-review",
        "col-done",
    ]
    assert data["columns"][0]["cardIds"] == ["card-1", "card-2"]
    assert data["cards"]["card-1"]["priority"] == "medium"
    assert len(data["cards"]) == 8


def test_save_round_trips_every_card_field(demo):
    payload = make_board(
        columns=[("col-backlog", "To do", ["card-1", "card-9"]), ("col-done", "Done", [])],
        cards={
            "card-1": card("card-1", "Ship feature", details="Ship the MVP"),
            "card-9": card(
                "card-9", "Due soon", priority="high", dueDate="2026-10-01", labels=["api", "urgent"]
            ),
        },
    )

    response = demo.put(DATA, json=payload)

    assert response.status_code == 200
    assert response.json() == payload
    assert demo.get(DATA).json() == payload
    assert demo.get(DEMO_BOARD).json()["cardCount"] == 2


def test_cards_without_new_fields_get_defaults(demo):
    payload = make_board(
        columns=[("col-backlog", "Backlog", ["card-1"])],
        cards={"card-1": {"id": "card-1", "title": "Legacy", "details": ""}},
    )

    assert demo.put(DATA, json=payload).status_code == 200

    assert demo.get(DATA).json()["cards"]["card-1"] == card("card-1", "Legacy")


def test_labels_are_trimmed(demo):
    payload = make_board(
        columns=[("col-backlog", "Backlog", ["card-1"])],
        cards={"card-1": card("card-1", labels=["  ui  "])},
    )

    assert demo.put(DATA, json=payload).json()["cards"]["card-1"]["labels"] == ["ui"]


def test_columns_can_be_added_removed_and_reordered(demo):
    payload = make_board(
        columns=[
            ("col-done", "Done", ["card-1"]),
            ("col-new", "Blocked", ["card-2"]),
            ("col-backlog", "Backlog", []),
        ],
        cards={"card-1": card("card-1"), "card-2": card("card-2")},
    )

    assert demo.put(DATA, json=payload).status_code == 200

    assert demo.get(DATA).json() == payload


def test_save_keeps_existing_column_keys(demo):
    payload = make_board(
        columns=[("col-review", "QA", []), ("col-backlog", "Ideas", []), ("col-x", "X", [])]
    )
    assert demo.put(DATA, json=payload).status_code == 200

    with get_connection() as conn:
        keys = [
            row["column_key"]
            for row in conn.execute(
                "SELECT column_key FROM board_columns WHERE board_id = 'board-1' ORDER BY sort_order"
            )
        ]

    assert keys == ["review", "backlog", "col-x"]


def test_saved_board_survives_restart_without_reseeding(demo):
    payload = make_board()
    assert demo.put(DATA, json=payload).status_code == 200

    init_database()

    assert demo.get(DATA).json() == payload


def test_boards_of_different_users_can_reuse_card_ids(demo, alice):
    alice_board = alice.get("/api/boards").json()[0]["id"]
    alice_data = alice.get(f"/api/boards/{alice_board}/data").json()
    alice_data["columns"][0]["cardIds"] = ["card-1"]
    alice_data["cards"] = {"card-1": card("card-1", "Alice's card")}

    assert alice.put(f"/api/boards/{alice_board}/data", json=alice_data).status_code == 200

    assert demo.get(DATA).json()["cards"]["card-1"]["title"] == "Align roadmap themes"
    assert alice.get(f"/api/boards/{alice_board}/data").json() == alice_data


@pytest.mark.parametrize(
    "payload",
    [
        {"columns": [], "cards": {}},
        {"columns": [{"id": f"c{i}", "title": "C", "cardIds": []} for i in range(13)], "cards": {}},
        make_board(columns=[("col-a", "A", []), ("col-a", "B", [])]),
        make_board(columns=[("col-a", "", [])]),
        make_board(columns=[("col-a", "A", ["card-1"])]),
        make_board(columns=[("col-a", "A", [])], cards={"card-1": card("card-1")}),
        make_board(
            columns=[("col-a", "A", ["card-1"]), ("col-b", "B", ["card-1"])],
            cards={"card-1": card("card-1")},
        ),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-2")}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", title="x" * 201)}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", priority="urgent")}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", dueDate="tomorrow")}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", labels=["a"] * 11)}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", labels=["a", "a"])}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", labels=["  "])}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", labels=["x" * 31])}),
        make_board(columns=[("col-a", "A", ["card-1"])], cards={"card-1": card("card-1", extra=True)}),
        {"columns": [], "cards": "not-an-object"},
    ],
)
def test_invalid_boards_are_rejected_and_nothing_changes(demo, payload):
    before = demo.get(DATA).json()

    assert demo.put(DATA, json=payload).status_code == 422

    assert demo.get(DATA).json() == before


def test_saving_preserves_the_original_created_at_and_advances_updated_at(demo):
    with get_connection() as conn:
        seeded_at = conn.execute("SELECT created_at FROM cards WHERE id = 'card-1'").fetchone()[
            "created_at"
        ]

    payload = make_board(
        columns=[("col-backlog", "Backlog", ["card-1", "card-new"])],
        cards={"card-1": card("card-1"), "card-new": card("card-new")},
    )
    assert demo.put(DATA, json=payload).status_code == 200

    with get_connection() as conn:
        rows = {
            row["id"]: row
            for row in conn.execute("SELECT id, created_at, updated_at FROM cards")
        }

    assert rows["card-1"]["created_at"] == seeded_at
    assert rows["card-1"]["updated_at"] >= seeded_at
    assert rows["card-new"]["created_at"] >= seeded_at


def test_saving_updates_the_board_timestamp(demo):
    before = demo.get(DEMO_BOARD).json()["updatedAt"]

    demo.put(DATA, json=make_board())

    assert demo.get(DEMO_BOARD).json()["updatedAt"] > before


def test_cards_cannot_reference_a_column_from_another_board(demo):
    board_id = demo.post("/api/boards", json={"title": "Other"}).json()["id"]

    # col-review belongs to board-1, so a card on the new board pointing at it must be rejected.
    with pytest.raises(sqlite3.IntegrityError):
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO cards (id, board_id, column_id, title, sort_order, created_at, updated_at) "
                "VALUES ('card-x', ?, 'col-review', 'Bad', 0, 'now', 'now')",
                (board_id,),
            )

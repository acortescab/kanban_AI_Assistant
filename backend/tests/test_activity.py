import copy

from app import activity
from app.database import get_connection
from app.schemas import BoardDataModel
from tests.conftest import DATA, DEMO_BOARD, MEMBERS, fake_model, registered_client, user_id

ACTIVITY = f"{DEMO_BOARD}/activity"


def messages(client, path=ACTIVITY):
    return [(entry["actor"], entry["message"]) for entry in client.get(path).json()]


def board(columns, cards):
    return BoardDataModel.model_validate(
        {
            "columns": [{"id": cid, "title": title, "cardIds": ids} for cid, title, ids in columns],
            "cards": {card_id: {"id": card_id, "title": title, **extra} for card_id, title, extra in cards},
        }
    )


# --- Describing changes ------------------------------------------------------


def test_describe_changes_covers_cards_and_columns():
    old = board(
        [("a", "Todo", ["c1", "c2", "c3"]), ("b", "Done", []), ("x", "Old", [])],
        [("c1", "One", {}), ("c2", "Two", {}), ("c3", "Three", {})],
    )
    new = board(
        [("b", "Shipped", ["c1"]), ("a", "Todo", ["c2"]), ("n", "New", ["c4"])],
        [
            ("c1", "One", {}),
            ("c2", "Two", {"priority": "high", "labels": ["x"], "assigneeId": "u1"}),
            ("c4", "Four", {"assigneeId": "u2"}),
        ],
    )

    described = activity.describe_changes(old, new, {"u1": "Alice"})

    assert described == [
        'renamed the column "Done" to "Shipped"',
        'added the column "New"',
        'removed the column "Old"',
        "reordered the columns",
        'moved "One" from Todo to Shipped',
        'updated "Two": priority, labels',
        'assigned "Two" to Alice',
        'added "Four" to New',
        'assigned "Four" to a former member',
        'deleted "Three"',
    ]


def test_reordering_cards_inside_a_column_is_not_logged():
    old = board([("a", "Todo", ["c1", "c2"])], [("c1", "One", {}), ("c2", "Two", {})])
    new = board([("a", "Todo", ["c2", "c1"])], [("c1", "One", {}), ("c2", "Two", {})])

    assert activity.describe_changes(old, new, {}) == []


def test_unassigning_is_logged():
    old = board([("a", "Todo", ["c1"])], [("c1", "One", {"assigneeId": "u1"})])
    new = board([("a", "Todo", ["c1"])], [("c1", "One", {})])

    assert activity.describe_changes(old, new, {"u1": "Alice"}) == ['unassigned "One"']


# --- Activity feed -----------------------------------------------------------


def test_saves_and_board_changes_are_logged_newest_first(demo):
    data = demo.get(DATA).json()
    data["columns"][0]["cardIds"].remove("card-1")
    data["columns"][-1]["cardIds"].append("card-1")
    demo.put(DATA, json=data)
    demo.patch(DEMO_BOARD, json={"title": "Launch", "description": "Ship it"})

    assert messages(demo) == [
        ("Demo User", "updated the description"),
        ("Demo User", 'renamed the board to "Launch"'),
        ("Demo User", 'moved "Align roadmap themes" from Backlog to Done'),
    ]
    entry = demo.get(ACTIVITY).json()[0]
    assert entry["id"] and entry["createdAt"]


def test_a_save_that_changes_nothing_logs_nothing(demo):
    demo.put(DATA, json=demo.get(DATA).json())
    demo.patch(DEMO_BOARD, json={"title": "Project Board"})

    assert messages(demo) == []


def test_new_boards_start_with_a_created_entry(alice):
    board_id = alice.get("/api/boards").json()[0]["id"]

    assert messages(alice, f"/api/boards/{board_id}/activity") == [("Alice", "created the board")]


def test_sharing_and_leaving_are_logged(demo, alice):
    bob = registered_client("bob", display_name="Bob")
    demo.post(MEMBERS, json={"username": "alice"})
    demo.post(MEMBERS, json={"username": "bob"})
    demo.delete(f"{MEMBERS}/{user_id(bob)}")
    alice.delete(f"{MEMBERS}/{user_id(alice)}")

    assert messages(demo) == [
        ("Alice", "left the board"),
        ("Demo User", "removed Bob from the board"),
        ("Demo User", "shared the board with Bob"),
        ("Demo User", "shared the board with Alice"),
    ]


def test_ai_edits_are_attributed_to_the_assistant(monkeypatch, demo):
    data = demo.get(DATA).json()
    changed = copy.deepcopy(data)
    changed["cards"]["card-1"]["title"] = "Renamed by AI"
    fake_model(monkeypatch, {"response": "Done.", "board": changed})

    demo.post(f"{DEMO_BOARD}/ai/chat", json={"question": "Rename"})

    assert messages(demo) == [("AI assistant (asked by Demo User)", 'updated "Renamed by AI": title')]


def test_activity_is_private_to_the_board(demo, alice, client):
    assert alice.get(ACTIVITY).status_code == 404
    assert client.get(ACTIVITY).status_code == 401


def test_activity_is_capped_per_board(demo, monkeypatch):
    monkeypatch.setattr(activity, "MAX_ACTIVITY_PER_BOARD", 3)
    for index in range(5):
        demo.patch(DEMO_BOARD, json={"title": f"Title {index}"})

    assert [message for _actor, message in messages(demo)] == [
        'renamed the board to "Title 4"',
        'renamed the board to "Title 3"',
        'renamed the board to "Title 2"',
    ]


def test_deleting_a_board_deletes_its_activity(demo):
    demo.patch(DEMO_BOARD, json={"title": "Soon gone"})
    demo.delete(DEMO_BOARD)

    with get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM activity").fetchone()[0] == 0


# --- Assignees ---------------------------------------------------------------


def assign(client, card_id, assignee, headers=None):
    data = client.get(DATA).json()
    data["cards"][card_id]["assigneeId"] = assignee
    return client.put(DATA, json=data, headers=headers or {})


def test_cards_can_be_assigned_to_the_owner_and_members(demo, alice):
    demo.post(MEMBERS, json={"username": "alice"})

    assert assign(demo, "card-1", "user-1").status_code == 200
    assert assign(demo, "card-2", user_id(alice)).status_code == 200

    cards = demo.get(DATA).json()["cards"]
    assert cards["card-1"]["assigneeId"] == "user-1"
    assert cards["card-2"]["assigneeId"] == user_id(alice)
    assert messages(demo)[0] == ("Demo User", 'assigned "Gather customer signals" to Alice')


def test_cards_cannot_be_assigned_to_outsiders(demo, alice):
    response = assign(demo, "card-1", user_id(alice))

    assert response.status_code == 422
    assert response.json()["detail"] == "Cards can only be assigned to people on the board."
    assert demo.get(DATA).json()["cards"]["card-1"]["assigneeId"] is None


def test_removing_a_member_unassigns_their_cards_and_moves_the_version(demo, alice):
    demo.post(MEMBERS, json={"username": "alice"})
    assign(demo, "card-1", user_id(alice))
    stale_version = demo.get(DATA).headers["ETag"]

    demo.delete(f"{MEMBERS}/{user_id(alice)}")

    assert demo.get(DATA).json()["cards"]["card-1"]["assigneeId"] is None
    # A client still holding the assignment must reload before saving.
    assert assign(demo, "card-2", None, headers={"If-Match": stale_version}).status_code == 409


def test_removing_a_member_without_cards_keeps_the_version(demo, alice):
    demo.post(MEMBERS, json={"username": "alice"})
    version = demo.get(DATA).headers["ETag"]

    demo.delete(f"{MEMBERS}/{user_id(alice)}")

    assert demo.get(DATA).headers["ETag"] == version


def test_deleting_a_member_account_unassigns_their_cards(demo, alice):
    demo.post(MEMBERS, json={"username": "alice"})
    assign(demo, "card-1", user_id(alice))

    alice.request("DELETE", "/api/auth/me", json={"password": "password123"})

    assert demo.get(DATA).json()["cards"]["card-1"]["assigneeId"] is None


def test_the_ai_is_told_who_can_be_assigned(monkeypatch, demo, alice):
    demo.post(MEMBERS, json={"username": "alice"})
    captured = fake_model(monkeypatch, {"response": "Hi", "board": None})

    demo.post(f"{DEMO_BOARD}/ai/chat", json={"question": "Who is here?"})

    system = captured["messages"][0]["content"]
    assert f'"{user_id(alice)}": "Alice"' in system
    assert system.index("People on the board") < system.index("Current board JSON")


def test_the_ai_cannot_assign_outsiders(monkeypatch, demo, alice):
    data = demo.get(DATA).json()
    data["cards"]["card-1"]["assigneeId"] = user_id(alice)
    fake_model(monkeypatch, {"response": "Assigned.", "board": data})

    response = demo.post(f"{DEMO_BOARD}/ai/chat", json={"question": "Assign to alice"})

    assert response.status_code == 502
    assert demo.get(DATA).json()["cards"]["card-1"]["assigneeId"] is None

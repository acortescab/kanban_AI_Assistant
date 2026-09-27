import pytest

from app.database import get_connection


def user_id(client) -> str:
    return client.get("/api/auth/me").json()["id"]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/api/admin/users", None),
        ("patch", "/api/admin/users/user-1", {"role": "user"}),
        ("delete", "/api/admin/users/user-1", None),
    ],
)
def test_admin_routes_are_for_admins_only(client, alice, method, path, body):
    assert client.request(method.upper(), path, json=body).status_code == 401
    response = alice.request(method.upper(), path, json=body)
    assert response.status_code == 403
    assert response.json()["detail"] == "Admins only."


def test_list_users_includes_roles_and_board_counts(demo, alice):
    alice.post("/api/boards", json={"title": "Second"})

    listed = {user["username"]: user for user in demo.get("/api/admin/users").json()}

    assert set(listed) == {"user", "alice"}
    assert listed["user"]["role"] == "admin"
    assert listed["user"]["boardCount"] == 1
    assert listed["alice"]["role"] == "user"
    assert listed["alice"]["displayName"] == "Alice"
    assert listed["alice"]["boardCount"] == 2
    assert "password_hash" not in listed["alice"]


def test_promote_and_demote_a_user(demo, alice):
    alice_id = user_id(alice)

    response = demo.patch(f"/api/admin/users/{alice_id}", json={"role": "admin"})
    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    assert alice.get("/api/admin/users").status_code == 200

    demo.patch(f"/api/admin/users/{alice_id}", json={"role": "user"})
    assert alice.get("/api/admin/users").status_code == 403


def test_role_must_be_known(demo, alice):
    response = demo.patch(f"/api/admin/users/{user_id(alice)}", json={"role": "owner"})

    assert response.status_code == 422


def test_admins_cannot_change_their_own_role(demo):
    response = demo.patch("/api/admin/users/user-1", json={"role": "user"})

    assert response.status_code == 400
    assert demo.get("/api/auth/me").json()["role"] == "admin"


def test_admin_can_delete_another_user_and_their_data(demo, alice):
    alice_id = user_id(alice)

    assert demo.delete(f"/api/admin/users/{alice_id}").status_code == 204

    assert alice.get("/api/auth/me").status_code == 401
    assert [user["username"] for user in demo.get("/api/admin/users").json()] == ["user"]
    with get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM boards WHERE user_id = ?", (alice_id,)).fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM sessions WHERE user_id = ?", (alice_id,)).fetchone()[0] == 0


def test_admins_cannot_delete_themselves_here(demo):
    assert demo.delete("/api/admin/users/user-1").status_code == 400
    assert demo.get("/api/auth/me").status_code == 200


def test_unknown_users_return_404(demo):
    assert demo.patch("/api/admin/users/nobody", json={"role": "admin"}).status_code == 404
    assert demo.delete("/api/admin/users/nobody").status_code == 404

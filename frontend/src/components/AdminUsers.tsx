"use client";

import { useEffect, useState } from "react";
import { api, errorMessage, personName, type AdminUser, type Role } from "@/lib/api";

type AdminUsersProps = {
  currentUserId: string;
};

export const AdminUsers = ({ currentUserId }: AdminUsersProps) => {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listUsers().then(setUsers, (caught) => setError(errorMessage(caught)));
  }, []);

  const changeRole = async (target: AdminUser, role: Role) => {
    setError("");
    try {
      const updated = await api.setRole(target.id, role);
      setUsers((list) =>
        list?.map((user) => (user.id === updated.id ? { ...user, role: updated.role } : user)) ?? null
      );
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const removeUser = async (target: AdminUser) => {
    const message = `Delete ${target.username} and their ${target.boardCount} boards? This cannot be undone.`;
    if (!window.confirm(message)) {
      return;
    }
    setError("");
    try {
      await api.deleteUser(target.id);
      setUsers((list) => list?.filter((user) => user.id !== target.id) ?? null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:px-6" data-testid="admin-users">
      <div className="mx-auto max-w-5xl">
        <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Users</h2>
        <p className="text-sm text-[var(--gray-text)]">
          Promote people to admin, or remove accounts and everything they own.
        </p>

        {error ? (
          <p className="mt-3 text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {users === null ? (
          error ? null : <p className="mt-4 text-sm text-[var(--gray-text)]">Loading users...</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--stroke)] bg-white shadow-[0_8px_24px_rgba(3,33,71,0.06)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-[var(--stroke)] text-xs uppercase tracking-wide text-[var(--gray-text)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Boards</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === currentUserId;
                  return (
                    <tr
                      key={user.id}
                      className="border-b border-[var(--stroke)] last:border-0"
                      data-testid={`user-row-${user.username}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[var(--navy-dark)]">
                          {personName(user)}
                          {isSelf ? <span className="font-normal text-[var(--gray-text)]"> (you)</span> : null}
                        </p>
                        <p className="text-xs text-[var(--gray-text)]">{user.username}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--navy-dark)]">{user.boardCount}</td>
                      <td className="px-4 py-3 text-[var(--gray-text)]">
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={user.role}
                          disabled={isSelf}
                          onChange={(event) => void changeRole(user, event.target.value as Role)}
                          aria-label={`Role for ${user.username}`}
                          className="rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-2 py-1 text-sm text-[var(--navy-dark)] disabled:opacity-60"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSelf ? null : (
                          <button
                            type="button"
                            onClick={() => void removeUser(user)}
                            className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:bg-red-50 hover:text-red-600"
                            aria-label={`Delete user ${user.username}`}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
};

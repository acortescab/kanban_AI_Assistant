"use client";

import { useState, type FormEvent } from "react";
import { api, errorMessage, personName, type BoardMember } from "@/lib/api";

type BoardMembersProps = {
  boardId: string;
  members: BoardMember[];
  isOwner: boolean;
  currentUserId: string;
  onMembersChange: (members: BoardMember[]) => void;
  onLeft: () => void;
};

export const BoardMembers = ({
  boardId,
  members,
  isOwner,
  currentUserId,
  onMembersChange,
  onLeft,
}: BoardMembersProps) => {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = username.trim();
    if (!name) {
      return;
    }
    setError("");
    try {
      onMembersChange(await api.addMember(boardId, name));
      setUsername("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const removeMember = async (member: BoardMember) => {
    const leaving = member.userId === currentUserId;
    if (leaving && !window.confirm("Leave this board? You will lose access to it.")) {
      return;
    }
    setError("");
    try {
      await api.removeMember(boardId, member.userId);
      if (leaving) {
        onLeft();
        return;
      }
      onMembersChange(members.filter((candidate) => candidate.userId !== member.userId));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <section
      className="mx-4 mt-3 rounded-2xl border border-[var(--stroke)] bg-white p-4 shadow-[0_8px_24px_rgba(3,33,71,0.06)] sm:mx-6"
      aria-label="Board members"
      data-testid="board-members"
    >
      <div className="flex flex-wrap items-start gap-4">
        <ul className="flex flex-1 flex-wrap gap-2">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId;
            const canRemove = member.role === "member" && (isOwner || isSelf);
            // The owner is marked as such; a member with a display name also shows the username.
            const note = member.role === "owner" ? "owner" : member.displayName && member.username;
            return (
              <li
                key={member.userId}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] bg-[var(--surface)] py-1 pl-3 pr-1 text-sm"
              >
                <span className="font-medium text-[var(--navy-dark)]">
                  {personName(member)}
                </span>
                {note ? <span className="text-xs text-[var(--gray-text)]">{note}</span> : null}
                {canRemove ? (
                  <button
                    type="button"
                    onClick={() => void removeMember(member)}
                    className="rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--gray-text)] transition hover:bg-red-50 hover:text-red-600"
                    aria-label={isSelf ? "Leave board" : `Remove ${member.username}`}
                  >
                    {isSelf ? "Leave" : "Remove"}
                  </button>
                ) : (
                  <span className="w-1" />
                )}
              </li>
            );
          })}
        </ul>
        {isOwner ? (
          <form onSubmit={addMember} className="flex items-center gap-2">
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              aria-label="Add member by username"
              maxLength={32}
              className="w-40 rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-2 py-1.5 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
            />
            <button
              type="submit"
              className="rounded-full bg-[var(--secondary-purple)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
            >
              Share
            </button>
          </form>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

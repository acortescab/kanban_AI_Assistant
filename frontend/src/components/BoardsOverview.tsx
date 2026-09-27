"use client";

import { useState, type FormEvent } from "react";
import { api, errorMessage, type BoardSummary } from "@/lib/api";

type BoardsOverviewProps = {
  boards: BoardSummary[];
  onOpen: (boardId: string) => void;
  onCreated: (board: BoardSummary) => void;
  onDeleted: (boardId: string) => void;
};

const formatUpdated = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const BoardsOverview = ({ boards, onOpen, onCreated, onDeleted }: BoardsOverviewProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }
    setError("");
    setIsCreating(true);
    try {
      const board = await api.createBoard(trimmedTitle, description.trim());
      setTitle("");
      setDescription("");
      onCreated(board);
    } catch (caught) {
      setError(errorMessage(caught, "Could not create the board."));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async (board: BoardSummary) => {
    const message = `Delete "${board.title}" and its ${board.cardCount} cards? This cannot be undone.`;
    if (!window.confirm(message)) {
      return;
    }
    setError("");
    try {
      await api.deleteBoard(board.id);
      onDeleted(board.id);
    } catch (caught) {
      setError(errorMessage(caught, "Could not delete the board."));
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:px-6" data-testid="boards-overview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Your boards</h2>
        <p className="text-sm text-[var(--gray-text)]">
          {boards.length} {boards.length === 1 ? "board" : "boards"}
        </p>
      </div>

      {error ? (
        <p className="mt-3 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {boards.map((board) => (
          <li
            key={board.id}
            className="flex flex-col rounded-2xl border border-[var(--stroke)] bg-white p-4 shadow-[0_8px_24px_rgba(3,33,71,0.06)]"
            data-testid={`board-tile-${board.id}`}
          >
            <button
              type="button"
              onClick={() => onOpen(board.id)}
              className="text-left font-display text-base font-semibold text-[var(--navy-dark)] hover:text-[var(--primary-blue)]"
            >
              {board.title}
            </button>
            <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-[var(--gray-text)]">
              {board.description || "No description"}
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-[var(--stroke)] pt-3 text-xs text-[var(--gray-text)]">
              <span>
                {board.cardCount} {board.cardCount === 1 ? "card" : "cards"} - updated{" "}
                {formatUpdated(board.updatedAt)}
                {board.memberCount > 0 ? ` - shared with ${board.memberCount}` : ""}
              </span>
              {board.isOwner ? (
                <button
                  type="button"
                  onClick={() => void handleDelete(board)}
                  className="rounded-md px-2 py-1 font-semibold text-[var(--gray-text)] transition hover:bg-red-50 hover:text-red-600"
                  aria-label={`Delete board ${board.title}`}
                >
                  Delete
                </button>
              ) : (
                <span className="font-semibold text-[var(--primary-blue)]">
                  Shared by {board.ownerName}
                </span>
              )}
            </div>
          </li>
        ))}

        <li className="rounded-2xl border border-dashed border-[rgba(3,33,71,0.2)] bg-white/60 p-4">
          <form onSubmit={handleCreate} className="space-y-2" aria-label="New board">
            <h3 className="text-sm font-semibold text-[var(--navy-dark)]">New board</h3>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Board title"
              aria-label="New board title"
              maxLength={100}
              className="w-full rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
              required
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description (optional)"
              aria-label="New board description"
              maxLength={500}
              className="w-full rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-3 py-2 text-sm text-[var(--gray-text)] outline-none focus:border-[var(--primary-blue)]"
            />
            <button
              type="submit"
              disabled={isCreating}
              className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-70"
            >
              Create board
            </button>
          </form>
        </li>
      </ul>
    </main>
  );
};

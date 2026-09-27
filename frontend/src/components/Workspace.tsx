"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { AccountSettings } from "@/components/AccountSettings";
import { AdminUsers } from "@/components/AdminUsers";
import { BoardsOverview } from "@/components/BoardsOverview";
import { KanbanBoard } from "@/components/KanbanBoard";
import { api, type BoardSummary, type User } from "@/lib/api";

type View =
  | { kind: "boards" }
  | { kind: "board"; boardId: string }
  | { kind: "account" }
  | { kind: "admin" };

type WorkspaceProps = {
  user: User;
  onUserChange: (user: User) => void;
  onLogout: () => void;
};

// Per-browser convenience only: which board to reopen. Storage can be unavailable.
const lastBoardKey = (userId: string) => `kanban:last-board:${userId}`;
const readLastBoard = (userId: string) => {
  try {
    return window.localStorage.getItem(lastBoardKey(userId));
  } catch {
    return null;
  }
};
const writeLastBoard = (userId: string, boardId: string) => {
  try {
    window.localStorage.setItem(lastBoardKey(userId), boardId);
  } catch {
    // Not remembering the board is fine.
  }
};

const LOAD_ERROR = "Could not load your boards. Please refresh the page.";

const navButtonClass =(active: boolean) =>
  clsx(
    "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition",
    active
      ? "border-[var(--navy-dark)] bg-[var(--navy-dark)] text-white"
      : "border-[var(--stroke)] bg-white text-[var(--navy-dark)] hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
  );

export const Workspace = ({ user, onUserChange, onLogout }: WorkspaceProps) => {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [view, setView] = useState<View>({ kind: "boards" });
  const [error, setError] = useState("");

  const refreshBoards = () => api.listBoards().then(setBoards, () => setError(LOAD_ERROR));

  useEffect(() => {
    api.listBoards().then(
      (list) => {
        setBoards(list);
        const remembered = readLastBoard(user.id);
        const initial = list.find((board) => board.id === remembered) ?? list[0];
        if (initial) {
          setView({ kind: "board", boardId: initial.id });
        }
      },
      () => setError(LOAD_ERROR)
    );
  }, [user.id]);

  const openBoard = (boardId: string) => {
    writeLastBoard(user.id, boardId);
    setView({ kind: "board", boardId });
  };

  const showBoards = () => {
    setView({ kind: "boards" });
    void refreshBoards();
  };

  const replaceSummary = (summary: BoardSummary) =>
    setBoards((list) => list?.map((board) => (board.id === summary.id ? summary : board)) ?? null);

  const activeBoard =
    view.kind === "board" ? boards?.find((board) => board.id === view.boardId) : undefined;

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--stroke)] border-t-[3px] border-t-[var(--accent-yellow)] bg-white px-4 py-3 sm:px-6">
        <h1 className="font-display text-xl font-semibold text-[var(--navy-dark)]">Kanban Studio</h1>

        {boards && boards.length > 0 ? (
          <select
            aria-label="Current board"
            value={activeBoard?.id ?? ""}
            onChange={(event) => openBoard(event.target.value)}
            className="max-w-[16rem] rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-2 py-1.5 text-sm font-medium text-[var(--navy-dark)] outline-none focus:border-[var(--primary-blue)]"
          >
            {activeBoard ? null : (
              <option value="" disabled>
                Choose a board
              </option>
            )}
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.title}
              </option>
            ))}
          </select>
        ) : null}

        <nav className="flex items-center gap-2" aria-label="Main">
          <button type="button" onClick={showBoards} className={navButtonClass(view.kind === "boards")}>
            All boards
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-[var(--gray-text)] sm:inline" data-testid="current-user">
            {user.displayName || user.username}
          </span>
          <button
            type="button"
            onClick={() => setView({ kind: "account" })}
            className={navButtonClass(view.kind === "account")}
          >
            Account
          </button>
          {user.role === "admin" ? (
            <button
              type="button"
              onClick={() => setView({ kind: "admin" })}
              className={navButtonClass(view.kind === "admin")}
            >
              Users
            </button>
          ) : null}
          <button type="button" onClick={onLogout} className={navButtonClass(false)}>
            Log out
          </button>
        </div>
      </header>

      {error ? (
        <p className="px-4 pt-3 text-sm font-medium text-red-600 sm:px-6" role="alert">
          {error}
        </p>
      ) : null}

      {view.kind === "board" && activeBoard ? (
        <KanbanBoard
          key={activeBoard.id}
          summary={activeBoard}
          currentUserId={user.id}
          onSummaryChange={replaceSummary}
          onLeft={() => {
            setBoards((list) => list?.filter((board) => board.id !== activeBoard.id) ?? null);
            setView({ kind: "boards" });
          }}
        />
      ) : null}

      {view.kind === "boards" && boards ? (
        <BoardsOverview
          boards={boards}
          onOpen={openBoard}
          onCreated={(board) => {
            setBoards((list) => [...(list ?? []), board]);
            openBoard(board.id);
          }}
          onDeleted={(boardId) =>
            setBoards((list) => list?.filter((board) => board.id !== boardId) ?? null)
          }
        />
      ) : null}

      {view.kind === "account" ? (
        <AccountSettings user={user} onUserChange={onUserChange} onAccountDeleted={onLogout} />
      ) : null}

      {view.kind === "admin" ? <AdminUsers currentUserId={user.id} /> : null}
    </div>
  );
};

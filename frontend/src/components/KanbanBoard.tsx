"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AiChatSidebar } from "@/components/AiChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import {
  createId,
  findColumnId,
  moveCard,
  type BoardData,
} from "@/lib/kanban";

const saveBoard = async (board: BoardData) => {
  const response = await fetch("/api/board", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(board),
  });

  if (!response.ok) {
    throw new Error("Failed to save board changes.");
  }

  return response.json();
};

export const KanbanBoard = () => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);

  useEffect(() => {
    fetch("/api/board")
      .then((response) => {
        if (!response.ok) {
          throw new Error();
        }
        return response.json() as Promise<BoardData>;
      })
      .then(setBoard)
      .catch(() => setError("Could not load the board. Please refresh the page."));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  if (!board) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p
          className="text-sm font-medium text-[var(--gray-text)]"
          role={error ? "alert" : undefined}
        >
          {error || "Loading board..."}
        </p>
      </main>
    );
  }

  // Saves run one at a time so the last change is always the last one written.
  const updateBoard = (nextBoard: BoardData) => {
    setBoard(nextBoard);
    pendingSaves.current += 1;
    setIsSaving(true);
    saveQueue.current = saveQueue.current
      .then(() => saveBoard(nextBoard))
      .then(() => setError(""))
      .catch(() => setError("Could not save your last change. Please refresh the page."))
      .finally(() => {
        pendingSaves.current -= 1;
        setIsSaving(pendingSaves.current > 0);
      });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
    setDragOverColumnId(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    setDragOverColumnId(over ? findColumnId(board.columns, String(over.id)) ?? null : null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);
    setDragOverColumnId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const columns = moveCard(board.columns, String(active.id), String(over.id));
    if (columns !== board.columns) {
      updateBoard({ ...board, columns });
    }
  };

  const handleRenameColumn = (columnId: string, title: string) => {
    updateBoard({
      ...board,
      columns: board.columns.map((column) =>
        column.id === columnId ? { ...column, title } : column
      ),
    });
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const id = createId("card");
    updateBoard({
      cards: {
        ...board.cards,
        [id]: { id, title, details },
      },
      columns: board.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    });
  };

  const handleEditCard = (cardId: string, title: string, details: string) => {
    updateBoard({
      ...board,
      cards: { ...board.cards, [cardId]: { id: cardId, title, details } },
    });
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    updateBoard({
      cards: Object.fromEntries(
        Object.entries(board.cards).filter(([id]) => id !== cardId)
      ),
      columns: board.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              cardIds: column.cardIds.filter((id) => id !== cardId),
            }
          : column
      ),
    });
  };

  const activeCard = activeCardId ? board.cards[activeCardId] : null;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1800px] flex-col gap-10 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Single Board Kanban
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Rename columns, drag cards between stages,
                and capture quick notes without getting buried in settings.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isSaving ? (
                <div className="rounded-full border border-[var(--stroke)] bg-white px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                  Saving
                </div>
              ) : null}
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {board.columns.map((column) => (
              <div
                key={column.id}
                className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
              >
                <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                {column.title}
              </div>
            ))}
          </div>
        </header>

        {error ? (
          <p className="text-sm font-medium text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {/* The chat sits beside the board only from 2xl (1536px); narrower screens give the columns the full width. */}
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <section className="grid gap-6 lg:grid-cols-5">
              {board.columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={column.cardIds.map((cardId) => board.cards[cardId])}
                  isDropTarget={dragOverColumnId === column.id}
                  onRename={handleRenameColumn}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                  onEditCard={handleEditCard}
                />
              ))}
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          <AiChatSidebar
            waitForSaves={() => saveQueue.current}
            onBoardUpdate={setBoard}
          />
        </div>
      </main>
    </div>
  );
};

"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { AiChatSidebar } from "@/components/AiChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { BoardActivity } from "@/components/BoardActivity";
import { api, ApiError, type BoardMember, type BoardSummary } from "@/lib/api";
import { BoardMembers } from "@/components/BoardMembers";
import { CardFilterBar } from "@/components/CardFilterBar";
import {
  addColumn,
  boardLabels,
  createId,
  EMPTY_FILTER,
  findColumnId,
  isFilterActive,
  isOverdue,
  matchesFilter,
  MAX_COLUMNS,
  moveCard,
  moveColumn,
  newCard,
  removeColumn,
  todayIso,
  type BoardData,
  type Card,
  type CardFilter,
} from "@/lib/kanban";

type KanbanBoardProps = {
  summary: BoardSummary;
  currentUserId: string;
  onSummaryChange: (summary: BoardSummary) => void;
  onLeft: () => void;
};

const loadBoard = async (boardId: string) => {
  try {
    return await api.getBoardData(boardId);
  } catch {
    return null;
  }
};

export const KanbanBoard = ({ summary, currentUserId, onSummaryChange, onLeft }: KanbanBoardProps) => {
  const boardId = summary.id;
  const [board, setBoard] = useState<BoardData | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [members, setMembers] = useState<BoardMember[]>([]);
  const [filter, setFilter] = useState<CardFilter>(EMPTY_FILTER);
  const [completedSaves, setCompletedSaves] = useState(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  // The server version the next save is based on (sent as If-Match).
  const version = useRef(0);
  // Bumped whenever the board on screen is replaced from the server (a failed save or an
  // AI edit). Saves queued before that were built on the replaced board, so they are dropped.
  const generation = useRef(0);
  // Counts board changes the activity feed should pick up (saves, AI edits, reloads).
  const [changeCount, setChangeCount] = useState(0);

  const trackVersion = (next: number) => {
    version.current = next;
    setChangeCount((count) => count + 1);
  };

  useEffect(() => {
    void loadBoard(boardId).then((loaded) => {
      if (loaded) {
        version.current = loaded.version;
        setBoard(loaded.board);
      } else {
        setError("Could not load the board. Please refresh the page.");
      }
    });
    // Needed for assignee names and choices. Without it cards still work, just unnamed.
    api.listMembers(boardId).then(setMembers, () => setMembers([]));
  }, [boardId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!board) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <p
          className="text-sm font-medium text-[var(--gray-text)]"
          role={error ? "alert" : undefined}
        >
          {error || "Loading board..."}
        </p>
      </main>
    );
  }

  // Every edit goes through this queue, so saves are sent one at a time, each based on the
  // version the previous one produced. The server refuses a save based on an old version
  // (someone else changed the board), and then the board is reloaded instead of overwritten.
  const updateBoard = (nextBoard: BoardData) => {
    setBoard(nextBoard);
    setError("");
    pendingSaves.current += 1;
    setIsSaving(true);
    const basedOn = generation.current;
    saveQueue.current = saveQueue.current
      .then(async () => {
        if (basedOn !== generation.current) {
          return;
        }
        const saved = await api.saveBoardData(boardId, nextBoard, version.current);
        trackVersion(saved.version);
        setCompletedSaves((count) => count + 1);
      })
      .catch(async (caught) => {
        // The screen is showing changes that were never written, so drop them
        // and fall back to the last state the server actually stored.
        generation.current += 1;
        const reloaded = await loadBoard(boardId);
        const conflict = caught instanceof ApiError && caught.status === 409;
        setError(
          !reloaded
            ? "Could not save your last change. Please refresh the page."
            : conflict
              ? "Someone else changed this board, so your last change was not saved. The latest version is shown."
              : "Could not save your last change. The board was reloaded from the server, so unsaved changes were lost."
        );
        if (reloaded) {
          trackVersion(reloaded.version);
          setBoard(reloaded.board);
        }
      })
      .finally(() => {
        pendingSaves.current -= 1;
        setIsSaving(pendingSaves.current > 0);
      });
  };

  // The AI already saved this board on the server, at this version.
  const applyAiBoard = (nextBoard: BoardData, nextVersion: number) => {
    generation.current += 1;
    trackVersion(nextVersion);
    setBoard(nextBoard);
    setError("");
  };

  const handleMembersChange = (next: BoardMember[]) => {
    const removed = next.length < members.length;
    setMembers(next);
    onSummaryChange({ ...summary, memberCount: next.length - 1 });
    if (removed) {
      // The server unassigned the removed person's cards and moved the version on, so
      // reload once the saves already queued have gone through.
      saveQueue.current = saveQueue.current.then(async () => {
        const reloaded = await loadBoard(boardId);
        if (reloaded) {
          generation.current += 1;
          trackVersion(reloaded.version);
          setBoard(reloaded.board);
        }
      });
    }
  };

  const saveSummary = async (changes: { title?: string; description?: string }) => {
    try {
      onSummaryChange(await api.updateBoard(boardId, changes));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the board.");
    }
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
        [id]: newCard(id, title, details),
      },
      columns: board.columns.map((column) =>
        column.id === columnId
          ? { ...column, cardIds: [...column.cardIds, id] }
          : column
      ),
    });
  };

  const handleEditCard = (card: Card) => {
    updateBoard({
      ...board,
      cards: { ...board.cards, [card.id]: card },
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
  const cards = Object.values(board.cards);
  const today = todayIso();
  const overdueCount = cards.filter((card) => isOverdue(card, today)).length;
  const highCount = cards.filter((card) => card.priority === "high").length;
  const labels = boardLabels(board);
  // A label filter outlives the label (the last card using it was edited or deleted); drop it
  // rather than hiding every card behind a choice the select can no longer show.
  // The same goes for an assignee who has since left the board.
  const activeFilter: CardFilter = {
    ...filter,
    label: labels.includes(filter.label) ? filter.label : "",
    assignee: members.some((member) => member.userId === filter.assignee) ? filter.assignee : "",
  };
  const filtering = isFilterActive(activeFilter);
  const isVisible = (cardId: string) => matchesFilter(board.cards[cardId], activeFilter, today);
  const visibleCount = filtering ? cards.filter((card) => isVisible(card.id)).length : cards.length;

  const commitSummaryField = (
    input: HTMLInputElement,
    field: "title" | "description",
    current: string
  ) => {
    const value = input.value.trim();
    if (field === "title" && !value) {
      input.value = current;
      return;
    }
    input.value = value;
    if (value !== current) {
      void saveSummary({ [field]: value });
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="board"
      data-saves-completed={completedSaves}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <input
            key={`title-${summary.title}`}
            defaultValue={summary.title}
            aria-label="Board title"
            maxLength={100}
            onBlur={(event) => commitSummaryField(event.currentTarget, "title", summary.title)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className="w-full max-w-xl rounded-md bg-transparent px-1 font-display text-lg font-semibold text-[var(--navy-dark)] outline-none transition hover:bg-white focus:bg-white"
          />
          <input
            key={`description-${summary.description}`}
            defaultValue={summary.description}
            aria-label="Board description"
            placeholder="Add a description"
            maxLength={500}
            onBlur={(event) =>
              commitSummaryField(event.currentTarget, "description", summary.description)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className="w-full max-w-xl rounded-md bg-transparent px-1 text-sm text-[var(--gray-text)] outline-none transition placeholder:text-[rgba(136,136,136,0.7)] hover:bg-white focus:bg-white"
          />
          {summary.isOwner ? null : (
            <p className="px-1 text-xs text-[var(--primary-blue)]" data-testid="shared-by">
              Shared with you by {summary.ownerName}
            </p>
          )}
        </div>
        <dl className="flex items-center gap-4 text-xs text-[var(--gray-text)]" data-testid="board-stats">
          <div className="flex items-baseline gap-1">
            <dt className="sr-only">Cards</dt>
            <dd className="text-base font-semibold text-[var(--navy-dark)]">{cards.length}</dd>
            <span aria-hidden="true">cards</span>
          </div>
          <div className="flex items-baseline gap-1">
            <dt className="sr-only">High priority</dt>
            <dd className="text-base font-semibold text-[var(--secondary-purple)]">{highCount}</dd>
            <span aria-hidden="true">high</span>
          </div>
          <div className="flex items-baseline gap-1">
            <dt className="sr-only">Overdue</dt>
            <dd
              className={clsx(
                "text-base font-semibold",
                overdueCount > 0 ? "text-red-600" : "text-[var(--navy-dark)]"
              )}
            >
              {overdueCount}
            </dd>
            <span aria-hidden="true">overdue</span>
          </div>
        </dl>
        <div className="flex items-center gap-3">
          {isSaving ? (
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
              Saving
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setIsMembersOpen((open) => !open)}
            aria-pressed={isMembersOpen}
            className={clsx(
              "flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition",
              isMembersOpen
                ? "border-[var(--primary-blue)] bg-[var(--primary-blue)] text-white"
                : "border-[var(--stroke)] bg-white text-[var(--primary-blue)] hover:border-[var(--primary-blue)]"
            )}
          >
            Members
            <span className="rounded-full bg-black/10 px-1.5 text-[10px] tracking-normal" data-testid="member-count">
              {summary.memberCount + 1}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setIsActivityOpen((open) => !open)}
            aria-pressed={isActivityOpen}
            className={clsx(
              "rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition",
              isActivityOpen
                ? "border-[var(--navy-dark)] bg-[var(--navy-dark)] text-white"
                : "border-[var(--stroke)] bg-white text-[var(--navy-dark)] hover:border-[var(--navy-dark)]"
            )}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => setIsChatOpen((open) => !open)}
            aria-pressed={isChatOpen}
            className={clsx(
              "rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] transition",
              isChatOpen
                ? "border-[var(--secondary-purple)] bg-[var(--secondary-purple)] text-white hover:brightness-110"
                : "border-[var(--stroke)] bg-white text-[var(--secondary-purple)] hover:border-[var(--secondary-purple)]"
            )}
          >
            AI chat
          </button>
        </div>
      </div>

      {isMembersOpen ? (
        <BoardMembers
          boardId={boardId}
          members={members}
          isOwner={summary.isOwner}
          currentUserId={currentUserId}
          onMembersChange={handleMembersChange}
          onLeft={onLeft}
        />
      ) : null}

      {isActivityOpen ? (
        <BoardActivity
          boardId={boardId}
          // Any logged change moves one of these: a board change, a rename, a member.
          refreshKey={`${changeCount}|${summary.title}|${summary.description}|${members.length}`}
        />
      ) : null}

      <CardFilterBar
        filter={activeFilter}
        labels={labels}
        members={members}
        currentUserId={currentUserId}
        visibleCount={visibleCount}
        totalCount={cards.length}
        onChange={setFilter}
      />

      {error ? (
        <p className="px-4 pt-3 text-sm font-medium text-red-600 sm:px-6" role="alert">
          {error}
        </p>
      ) : null}

      {/* From lg the board and chat fill the viewport side by side and scroll internally;
          narrower screens stack them and scroll the columns horizontally. */}
      <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:px-6 lg:flex-row">
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <section className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto pb-1">
            {board.columns.map((column, index) => (
              <KanbanColumn
                key={column.id}
                column={column}
                cards={column.cardIds.filter(isVisible).map((cardId) => board.cards[cardId])}
                isFiltered={filtering}
                today={today}
                isDropTarget={dragOverColumnId === column.id}
                members={members}
                canDelete={board.columns.length > 1 && column.cardIds.length === 0}
                canMoveLeft={index > 0}
                canMoveRight={index < board.columns.length - 1}
                onRename={handleRenameColumn}
                onMove={(columnId, offset) => updateBoard(moveColumn(board, columnId, offset))}
                onDelete={(columnId) => updateBoard(removeColumn(board, columnId))}
                onAddCard={handleAddCard}
                onDeleteCard={handleDeleteCard}
                onEditCard={handleEditCard}
              />
            ))}
            {board.columns.length < MAX_COLUMNS ? (
              <button
                type="button"
                onClick={() => updateBoard(addColumn(board, createId("col"), "New column"))}
                className="flex w-12 shrink-0 items-start justify-center self-start rounded-2xl border border-dashed border-[rgba(3,33,71,0.2)] py-4 text-[var(--primary-blue)] transition hover:border-[var(--primary-blue)] hover:bg-[rgba(32,157,215,0.05)]"
                aria-label="Add column"
                title="Add column"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-none stroke-current stroke-[2.5] [stroke-linecap:round]"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            ) : null}
          </section>
          <DragOverlay>
            {activeCard ? (
              <div className="w-[260px]">
                <KanbanCardPreview card={activeCard} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Hidden rather than unmounted, so closing the chat keeps its conversation. */}
        <div className="contents" hidden={!isChatOpen}>
          <AiChatSidebar
            boardId={boardId}
            waitForSaves={() => saveQueue.current}
            onBoardUpdate={applyAiBoard}
          />
        </div>
      </main>
    </div>
  );
};

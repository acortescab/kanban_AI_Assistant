import type { KeyboardEvent } from "react";
import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { BoardMember } from "@/lib/api";
import type { Card, Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

const headerButtonClass =
  "flex h-6 w-5 shrink-0 items-center justify-center rounded-md text-[var(--gray-text)] transition hover:bg-[var(--surface)] hover:text-[var(--navy-dark)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

// For inline title inputs that save on blur: Enter commits by blurring.
export const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }
};

const Chevron =({ direction }: { direction: "left" | "right" }) => (
  <svg
    viewBox="0 0 24 24"
    className="h-3.5 w-3.5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
    aria-hidden="true"
    focusable="false"
  >
    <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
  </svg>
);

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  today: string;
  members: BoardMember[];
  isDropTarget?: boolean;
  isFiltered?: boolean;
  canDelete: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onRename: (columnId: string, title: string) => void;
  onMove: (columnId: string, offset: -1 | 1) => void;
  onDelete: (columnId: string) => void;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onDeleteCard: (columnId: string, cardId: string) => void;
  onEditCard: (card: Card) => void;
};

export const KanbanColumn = ({
  column,
  cards,
  today,
  members,
  isDropTarget = false,
  isFiltered = false,
  canDelete,
  canMoveLeft,
  canMoveRight,
  onRename,
  onMove,
  onDelete,
  onAddCard,
  onDeleteCard,
  onEditCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const isHighlighted = isOver || isDropTarget;

  const commitTitle = (input: HTMLInputElement) => {
    const nextTitle = input.value.trim() || column.title;
    input.value = nextTitle;
    if (nextTitle !== column.title) {
      onRename(column.id, nextTitle);
    }
  };

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[420px] min-w-[240px] flex-1 basis-0 flex-col overflow-hidden rounded-2xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-3 shadow-[0_8px_24px_rgba(3,33,71,0.06)] transition lg:min-h-0",
        isHighlighted && "ring-2 ring-[var(--accent-yellow)]"
      )}
      data-testid={`column-${column.id}`}
    >
      <div className="flex items-center gap-1.5 border-b-2 border-[var(--accent-yellow)] pb-2">
        <input
          key={column.title}
          defaultValue={column.title}
          maxLength={100}
          onBlur={(event) => commitTitle(event.currentTarget)}
          onKeyDown={blurOnEnter}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 font-display text-base font-semibold text-[var(--navy-dark)] outline-none transition hover:bg-[var(--surface)] focus:bg-[var(--surface)]"
          aria-label="Column title"
        />
        <span
          className="shrink-0 rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs font-semibold text-[var(--gray-text)]"
          title={`${cards.length} cards`}
        >
          {cards.length}
        </span>
        <button
          type="button"
          onClick={() => onMove(column.id, -1)}
          disabled={!canMoveLeft}
          className={headerButtonClass}
          aria-label={`Move column ${column.title} left`}
          title="Move left"
        >
          <Chevron direction="left" />
        </button>
        <button
          type="button"
          onClick={() => onMove(column.id, 1)}
          disabled={!canMoveRight}
          className={headerButtonClass}
          aria-label={`Move column ${column.title} right`}
          title="Move right"
        >
          <Chevron direction="right" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(column.id)}
          disabled={!canDelete}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--gray-text)] transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--gray-text)]"
          aria-label={`Delete column ${column.title}`}
          title={canDelete ? "Delete column" : "Only an empty column can be deleted, and a board keeps at least one"}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="-mr-1 mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              today={today}
              members={members}
              onDelete={(cardId) => onDeleteCard(column.id, cardId)}
              onEdit={onEditCard}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-[var(--stroke)] px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            {isFiltered ? "No matching cards" : "Drop a card here"}
          </div>
        )}
      </div>
      <NewCardForm onAdd={(title, details) => onAddCard(column.id, title, details)} />
    </section>
  );
};

import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { Card } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  onDelete: (cardId: string) => void;
  onEdit: (cardId: string, title: string, details: string) => void;
};

export const KanbanCard = ({ card, onDelete, onEdit }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState({ title: card.title, details: card.details });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: isEditing });

  // While editing, skip the drag props: they add role="button" and aria-disabled around the form.
  const dragProps = isEditing ? {} : { ...attributes, ...listeners };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const startEditing = () => {
    setDraft({ title: card.title, details: card.details });
    setIsEditing(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      return;
    }
    onEdit(card.id, title, draft.details.trim());
    setIsEditing(false);
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-2xl border border-transparent bg-white px-4 py-4 shadow-[0_12px_24px_rgba(3,33,71,0.08)]",
        "transition-all duration-150",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...dragProps}
      data-testid={`card-${card.id}`}
    >
      {isEditing ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            aria-label="Card title"
            className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
            required
            autoFocus
          />
          <textarea
            value={draft.details}
            onChange={(event) => setDraft((prev) => ({ ...prev, details: event.target.value }))}
            aria-label="Card details"
            rows={3}
            className="w-full resize-none rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--gray-text)] outline-none transition focus:border-[var(--primary-blue)]"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-full border border-[var(--stroke)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div>
          <h4 className="font-display text-base font-semibold text-[var(--navy-dark)]">
            {card.title}
          </h4>
          {card.details ? (
            <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
              {card.details}
            </p>
          ) : null}
          <div className="-mx-2 mt-2 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={startEditing}
              className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--primary-blue)] transition hover:border-[var(--stroke)]"
              aria-label={`Edit ${card.title}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(card.id)}
              className="rounded-full border border-transparent px-2 py-1 text-xs font-semibold text-[var(--gray-text)] transition hover:border-[var(--stroke)] hover:text-[var(--navy-dark)]"
              aria-label={`Delete ${card.title}`}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </article>
  );
};

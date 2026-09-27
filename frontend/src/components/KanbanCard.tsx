import { useState, type FormEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import type { BoardMember } from "@/lib/api";
import {
  formatDueDate,
  initials,
  isOverdue,
  parseLabels,
  PRIORITIES,
  type Card,
  type Priority,
} from "@/lib/kanban";

const iconClass =
  "h-3.5 w-3.5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";

const fieldClass =
  "w-full rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-2 py-1.5 text-xs text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";

// Medium is the default, so only the two informative priorities get a badge.
const PRIORITY_BADGE: Partial<Record<Priority, string>> = {
  high: "bg-[rgba(117,57,145,0.12)] text-[var(--secondary-purple)]",
  low: "bg-[var(--surface)] text-[var(--gray-text)]",
};

type KanbanCardProps = {
  card: Card;
  today: string;
  members: BoardMember[];
  onDelete: (cardId: string) => void;
  onEdit: (card: Card) => void;
};

const toDraft = (card: Card) => ({
  title: card.title,
  details: card.details,
  priority: card.priority,
  dueDate: card.dueDate ?? "",
  labels: card.labels.join(", "),
  assigneeId: card.assigneeId ?? "",
});

const memberName = (member: BoardMember) => member.displayName || member.username;

export const KanbanCard = ({ card, today, members, onDelete, onEdit }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(card));
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const startEditing = () => {
    setDraft(toDraft(card));
    setIsEditing(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) {
      return;
    }
    onEdit({
      id: card.id,
      title,
      details: draft.details.trim(),
      priority: draft.priority,
      dueDate: draft.dueDate || null,
      labels: parseLabels(draft.labels),
      assigneeId: draft.assigneeId || null,
    });
    setIsEditing(false);
  };

  const overdue = isOverdue(card, today);
  const assignee = members.find((member) => member.userId === card.assigneeId);
  const hasMeta =
    card.priority !== "medium" ||
    card.dueDate !== null ||
    card.labels.length > 0 ||
    assignee !== undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        "rounded-xl border border-[var(--stroke)] bg-white p-3 shadow-[0_2px_6px_rgba(3,33,71,0.06)]",
        "transition-[border-color,box-shadow] duration-150 hover:border-[rgba(32,157,215,0.4)]",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
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
          {/* Stacked, not side by side: a column is too narrow for a date input next to a select. */}
          <div className="grid gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--gray-text)]">
              Priority
              <select
                value={draft.priority}
                onChange={(event) =>
                  setDraft((prev) => ({ ...prev, priority: event.target.value as Priority }))
                }
                aria-label="Card priority"
                className={clsx(fieldClass, "mt-1 normal-case tracking-normal")}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority[0].toUpperCase() + priority.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--gray-text)]">
              Due
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => setDraft((prev) => ({ ...prev, dueDate: event.target.value }))}
                aria-label="Card due date"
                className={clsx(fieldClass, "mt-1 normal-case tracking-normal")}
              />
            </label>
          </div>
          <input
            value={draft.labels}
            onChange={(event) => setDraft((prev) => ({ ...prev, labels: event.target.value }))}
            aria-label="Card labels"
            placeholder="Labels, comma separated"
            className={fieldClass}
          />
          <select
            value={draft.assigneeId}
            onChange={(event) => setDraft((prev) => ({ ...prev, assigneeId: event.target.value }))}
            aria-label="Card assignee"
            className={fieldClass}
          >
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {memberName(member)}
              </option>
            ))}
          </select>
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
        <>
          <div className="flex items-start gap-1.5">
            {/* The handle is the card's only drag surface, so it carries the button role
                and the keyboard sensor instead of nesting them around the card body. */}
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--gray-text)] transition hover:bg-[var(--surface)] hover:text-[var(--navy-dark)] active:cursor-grabbing"
              aria-label={`Move ${card.title}`}
              data-testid={`card-handle-${card.id}`}
            >
              <svg
                viewBox="0 0 10 16"
                className="h-3.5 w-2 fill-current"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="2" cy="2" r="1.5" />
                <circle cx="8" cy="2" r="1.5" />
                <circle cx="2" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="2" cy="14" r="1.5" />
                <circle cx="8" cy="14" r="1.5" />
              </svg>
            </button>
            <h4 className="min-w-0 flex-1 break-words pt-0.5 font-display text-sm font-semibold leading-5 text-[var(--navy-dark)]">
              {card.title}
            </h4>
            <div className="-mr-1 flex shrink-0 items-center">
              <button
                type="button"
                onClick={startEditing}
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--gray-text)] transition hover:bg-[var(--surface)] hover:text-[var(--primary-blue)]"
                aria-label={`Edit ${card.title}`}
                title="Edit"
              >
                <svg viewBox="0 0 24 24" className={iconClass} aria-hidden="true" focusable="false">
                  <path d="M21.17 6.81a2.82 2.82 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" />
                  <path d="m15 5 4 4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => onDelete(card.id)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--gray-text)] transition hover:bg-red-50 hover:text-red-600"
                aria-label={`Delete ${card.title}`}
                title="Delete"
              >
                <svg viewBox="0 0 24 24" className={iconClass} aria-hidden="true" focusable="false">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          </div>
          {card.details ? (
            <p className="mt-1 break-words pl-[22px] text-xs leading-5 text-[var(--gray-text)]">
              {card.details}
            </p>
          ) : null}
          {hasMeta ? (
            <div className="mt-2 flex flex-wrap items-center gap-1 pl-[22px]">
              {PRIORITY_BADGE[card.priority] ? (
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    PRIORITY_BADGE[card.priority]
                  )}
                >
                  {card.priority}
                </span>
              ) : null}
              {card.dueDate ? (
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    overdue
                      ? "bg-red-50 text-red-600"
                      : "bg-[rgba(32,157,215,0.1)] text-[var(--primary-blue)]"
                  )}
                  title={overdue ? `Overdue since ${card.dueDate}` : `Due ${card.dueDate}`}
                  data-testid={`due-${card.id}`}
                >
                  {overdue ? "Overdue " : "Due "}
                  {formatDueDate(card.dueDate)}
                </span>
              ) : null}
              {card.labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-[rgba(236,173,10,0.5)] bg-[rgba(236,173,10,0.08)] px-2 py-0.5 text-[10px] font-medium text-[var(--navy-dark)]"
                >
                  {label}
                </span>
              ))}
              {assignee ? (
                <span
                  className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--primary-blue)] px-1 text-[10px] font-semibold text-white"
                  title={`Assigned to ${memberName(assignee)}`}
                  aria-label={`Assigned to ${memberName(assignee)}`}
                  data-testid={`assignee-${card.id}`}
                >
                  {initials(memberName(assignee))}
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
};

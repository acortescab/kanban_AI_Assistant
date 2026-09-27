import clsx from "clsx";
import type { BoardMember } from "@/lib/api";
import { EMPTY_FILTER, isFilterActive, PRIORITIES, type CardFilter, type Priority } from "@/lib/kanban";

type CardFilterBarProps = {
  filter: CardFilter;
  labels: string[];
  members: BoardMember[];
  currentUserId: string;
  visibleCount: number;
  totalCount: number;
  onChange: (filter: CardFilter) => void;
};

const controlClass =
  "rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-2 py-1.5 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";

export const CardFilterBar = ({
  filter,
  labels,
  members,
  currentUserId,
  visibleCount,
  totalCount,
  onChange,
}: CardFilterBarProps) => {
  const active = isFilterActive(filter);
  const update = (changes: Partial<CardFilter>) => onChange({ ...filter, ...changes });

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-3 sm:px-6" role="search">
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 fill-none stroke-[var(--gray-text)] stroke-2 [stroke-linecap:round]"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          type="search"
          value={filter.text}
          onChange={(event) => update({ text: event.target.value })}
          placeholder="Search cards"
          aria-label="Search cards"
          className={clsx(controlClass, "w-56 pl-8")}
        />
      </div>
      <select
        value={filter.priority}
        onChange={(event) => update({ priority: event.target.value as Priority | "all" })}
        aria-label="Filter by priority"
        className={controlClass}
      >
        <option value="all">Any priority</option>
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {priority[0].toUpperCase() + priority.slice(1)} priority
          </option>
        ))}
      </select>
      {labels.length > 0 ? (
        <select
          value={filter.label}
          onChange={(event) => update({ label: event.target.value })}
          aria-label="Filter by label"
          className={controlClass}
        >
          <option value="">Any label</option>
          {labels.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      ) : null}
      {members.length > 0 ? (
        <select
          value={filter.assignee}
          onChange={(event) => update({ assignee: event.target.value })}
          aria-label="Filter by assignee"
          className={controlClass}
        >
          <option value="">Anyone</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.userId === currentUserId
                ? "Assigned to me"
                : member.displayName || member.username}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        onClick={() => update({ overdueOnly: !filter.overdueOnly })}
        aria-pressed={filter.overdueOnly}
        className={clsx(
          "rounded-lg border px-3 py-1.5 text-sm transition",
          filter.overdueOnly
            ? "border-red-200 bg-red-50 font-semibold text-red-600"
            : "border-[rgba(3,33,71,0.15)] bg-white text-[var(--navy-dark)] hover:border-red-200"
        )}
      >
        Overdue only
      </button>
      {active ? (
        <>
          <span className="text-sm text-[var(--gray-text)]" data-testid="filter-count">
            Showing {visibleCount} of {totalCount} cards
          </span>
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTER)}
            className="rounded-md px-2 py-1 text-sm font-semibold text-[var(--primary-blue)] hover:underline"
          >
            Clear filters
          </button>
        </>
      ) : null}
    </div>
  );
};

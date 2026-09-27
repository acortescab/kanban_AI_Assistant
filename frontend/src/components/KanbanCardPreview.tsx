import type { Card } from "@/lib/kanban";

type KanbanCardPreviewProps = {
  card: Card;
};

export const KanbanCardPreview = ({ card }: KanbanCardPreviewProps) => (
  <article className="rotate-1 rounded-xl border border-[rgba(32,157,215,0.4)] bg-white p-3 shadow-[0_18px_32px_rgba(3,33,71,0.16)]">
    <h4 className="break-words font-display text-sm font-semibold leading-5 text-[var(--navy-dark)]">
      {card.title}
    </h4>
    {card.details ? (
      <p className="mt-1 break-words text-xs leading-5 text-[var(--gray-text)]">
        {card.details}
      </p>
    ) : null}
  </article>
);

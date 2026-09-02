/**
 * One settings card.
 *
 * Extracted because there are a dozen of them and a settings page where the
 * cards disagree about their own padding is the visual signal that nobody owns
 * the section.
 */
export function Section({
  title,
  description,
  children,
  tone = 'default',
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** `danger` gets the heavier frame. Reserved for irreversible actions. */
  tone?: 'default' | 'danger';
}) {
  return (
    <section
      className={
        tone === 'danger'
          ? 'rounded-[var(--tg-radius-lg)] border-2 border-border-strong bg-bg-raised p-5'
          : 'rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-5'
      }
    >
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

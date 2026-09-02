/**
 * The long-form text wrapper for the public documentation and legal pages.
 *
 * These pages are mostly headings and paragraphs, and a crawler reads their
 * structure as much as a person does — so the elements are semantic (`h2`,
 * `h3`, `p`, `ul`) and the styling is applied from here rather than by
 * decorating each tag at every call site. One heading hierarchy, one measure,
 * one set of margins.
 */
export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="
        max-w-2xl
        [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight
        [&_h3]:mt-7 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:tracking-tight
        [&_p]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-fg-muted
        [&_ul]:mt-3 [&_ul]:space-y-2 [&_ul]:pl-5
        [&_li]:list-disc [&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-fg-muted
        [&_code]:rounded [&_code]:bg-bg-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-fg
        [&_a]:text-fg [&_a]:underline [&_a]:underline-offset-2
      "
    >
      {children}
    </div>
  );
}

import type { CSSProperties } from 'react';

/**
 * `CSSProperties` rejects custom properties, so components that need to hand a
 * token down to a stylesheet rule need this widened type.
 *
 * The pattern throughout this package: a component sets token-derived custom
 * properties inline (`--tg-btn-bg: var(--tg-accent)`) and `styles.css` consumes
 * them. Inline styles cannot express `:hover` / `:focus-visible` / `:disabled`,
 * and an inline `background` would out-specify any rule that tried to, so the
 * variable is the inline part and the state lives in real CSS.
 */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>;

/** Merge a component's base style with a caller override; the caller wins. */
export function mergeStyles(base: StyleWithVars, override?: CSSProperties): CSSProperties {
  return override ? { ...base, ...override } : base;
}

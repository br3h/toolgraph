/**
 * Join class names, dropping anything falsy.
 *
 * Deliberately dependency-free: this package is consumed by an app that uses
 * Tailwind, but the package itself must not take on `clsx` or a Tailwind
 * dependency of its own.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  let out = '';

  for (const part of parts) {
    if (!part) continue;
    const trimmed = part.trim();
    if (!trimmed) continue;
    out = out === '' ? trimmed : `${out} ${trimmed}`;
  }

  return out;
}

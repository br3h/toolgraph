/**
 * Theme mode: `system` follows `prefers-color-scheme`, the other two pin the
 * document to one theme. Persisted under a single localStorage key and mirrored
 * onto `document.documentElement.dataset.theme`, which is what `styles.css`
 * keys its overrides off.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** The one key this package touches in localStorage. */
export const THEME_STORAGE_KEY = 'toolgraph-theme';

/** Cycle order for the toggle: system -> light -> dark -> system. */
export const THEME_MODES = ['system', 'light', 'dark'] as const satisfies readonly ThemeMode[];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * The next mode in the cycle. A value outside the cycle — stale storage, a
 * hand-edited attribute — restarts it at `system` rather than throwing.
 */
export function nextTheme(current: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(current);
  return THEME_MODES[(index + 1) % THEME_MODES.length] ?? 'system';
}

/**
 * Read the stored mode. Every access is guarded: a private window, blocked site
 * data or a server render must degrade to `system`, never break the page.
 */
export function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';

  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the mode. Silently a no-op when storage is unavailable. */
export function writeStoredTheme(mode: ThemeMode): boolean {
  if (typeof window === 'undefined') return false;

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply the mode to the document element. `system` removes the attribute so the
 * `prefers-color-scheme` media query in `styles.css` takes over again.
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.dataset.theme = mode;
  }
}

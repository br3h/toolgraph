import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  isThemeMode,
  nextTheme,
  readStoredTheme,
  THEME_MODES,
  THEME_STORAGE_KEY,
  writeStoredTheme,
  type ThemeMode,
} from './theme';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nextTheme', () => {
  it('cycles system -> light -> dark -> system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('returns to the starting mode after three steps', () => {
    let mode: ThemeMode = 'system';
    const seen: ThemeMode[] = [];

    for (let i = 0; i < 3; i += 1) {
      mode = nextTheme(mode);
      seen.push(mode);
    }

    expect(seen).toEqual(['light', 'dark', 'system']);
    expect(mode).toBe('system');
  });

  it('visits every mode exactly once per cycle', () => {
    const visited = new Set<ThemeMode>(['system', nextTheme('system'), nextTheme('light')]);
    expect(visited).toEqual(new Set(THEME_MODES));
  });

  it('restarts at system when handed a value outside the cycle', () => {
    // Stale storage or a hand-edited attribute must not wedge the toggle.
    expect(nextTheme('sepia' as ThemeMode)).toBe('system');
  });
});

describe('isThemeMode', () => {
  it('accepts the three modes', () => {
    expect(THEME_MODES.every(isThemeMode)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['', 'Light', 'SYSTEM', null, undefined, 0, {}, ['dark']]) {
      expect(isThemeMode(value)).toBe(false);
    }
  });
});

describe('storage access', () => {
  it('falls back to system when there is no window at all', () => {
    expect(readStoredTheme()).toBe('system');
    expect(writeStoredTheme('dark')).toBe(false);
  });

  it('reads a stored mode back', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (key === THEME_STORAGE_KEY ? 'dark' : null),
        setItem: () => undefined,
      },
    });

    expect(readStoredTheme()).toBe('dark');
  });

  it('falls back to system when the stored value is not a mode', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'chartreuse', setItem: () => undefined },
    });

    expect(readStoredTheme()).toBe('system');
  });

  it('survives storage that throws, which is what a locked-down browser does', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
        setItem: () => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        },
      },
    });

    expect(readStoredTheme()).toBe('system');
    expect(writeStoredTheme('light')).toBe(false);
  });

  it('writes under the one key this package owns', () => {
    const writes: Array<[string, string]> = [];
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: (key: string, value: string) => {
          writes.push([key, value]);
        },
      },
    });

    expect(writeStoredTheme('light')).toBe(true);
    expect(writes).toEqual([['toolgraph-theme', 'light']]);
  });
});

describe('applyTheme', () => {
  function stubDocument(): { theme?: string } {
    const dataset: { theme?: string } = {};
    vi.stubGlobal('document', {
      documentElement: {
        dataset,
        removeAttribute: (name: string) => {
          if (name === 'data-theme') delete dataset.theme;
        },
      },
    });
    return dataset;
  }

  it('does nothing when there is no document', () => {
    expect(() => applyTheme('dark')).not.toThrow();
  });

  it('pins the document to an explicit mode', () => {
    const dataset = stubDocument();

    applyTheme('dark');
    expect(dataset.theme).toBe('dark');

    applyTheme('light');
    expect(dataset.theme).toBe('light');
  });

  it('removes the attribute for system, handing control back to the media query', () => {
    const dataset = stubDocument();

    applyTheme('dark');
    applyTheme('system');

    expect(dataset.theme).toBeUndefined();
    expect('theme' in dataset).toBe(false);
  });
});

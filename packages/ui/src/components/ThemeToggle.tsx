'use client';

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeMode,
} from '../lib/theme';
import { Button, type ButtonSize } from './Button';
import { DarkThemeIcon, LightThemeIcon, SystemThemeIcon, type IconProps } from './icons';

export interface ThemeToggleProps {
  size?: ButtonSize;
  /** Notified after every change, e.g. to re-render a canvas that caches colours. */
  onChange?: (mode: ThemeMode) => void;
  className?: string;
}

const ICONS: Record<ThemeMode, (props: IconProps) => ReactElement> = {
  system: SystemThemeIcon,
  light: LightThemeIcon,
  dark: DarkThemeIcon,
};

const LABELS: Record<ThemeMode, string> = {
  system: 'system',
  light: 'light',
  dark: 'dark',
};

const ICON_PX: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 };

/**
 * Cycles system -> light -> dark.
 *
 * The first render always draws `system`, on the server and on the client
 * alike, and the stored mode is adopted in an effect — anything else would
 * hydrate a different tree than the server sent. The *document* does not wait
 * for that: `themeInitScript` has already applied the stored theme before first
 * paint, so only this button's glyph settles a frame late, never the page.
 */
export function ThemeToggle({ size = 'sm', onChange, className }: ThemeToggleProps): ReactElement {
  const [mode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    const stored = readStoredTheme();
    setMode(stored);
    // Re-apply rather than trust the init script: it may have been skipped by
    // a strict CSP, and this is the cheap way to converge either way.
    applyTheme(stored);
  }, []);

  const upcoming = nextTheme(mode);
  const Icon = ICONS[mode];

  function cycle(): void {
    setMode(upcoming);
    applyTheme(upcoming);
    writeStoredTheme(upcoming);
    onChange?.(upcoming);
  }

  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      onClick={cycle}
      aria-label={`Theme: ${LABELS[mode]}. Switch to ${LABELS[upcoming]}.`}
      title={`Theme: ${LABELS[mode]}`}
      data-theme-mode={mode}
    >
      <Icon size={ICON_PX[size]} />
    </Button>
  );
}

/**
 * Public surface of the toolgraph design system.
 *
 * Consumers import components and helpers from here and the stylesheet from
 * `@toolgraph/ui/styles.css`; nothing reaches into `src/components/*` directly.
 * Every component paints from the tokens in that stylesheet — there is no hue
 * anywhere in this package, and `src/styles.test.ts` enforces it.
 */

export { Alert, type AlertProps, type AlertVariant } from './components/Alert';
export { Badge, type BadgeProps, type BadgeVariant } from './components/Badge';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './components/Button';
export { Card, type CardProps } from './components/Card';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export {
  describedBy,
  FieldShell,
  useFieldIds,
  type FieldIds,
  type FieldShellProps,
} from './components/Field';
export { Input, type InputProps } from './components/Input';
export { Modal, type ModalProps, type ModalSize } from './components/Modal';
export { Select, type SelectProps } from './components/Select';
export { Skeleton, type SkeletonProps } from './components/Skeleton';
export { Spinner, type SpinnerProps, type SpinnerSize } from './components/Spinner';
export { Textarea, type TextareaProps } from './components/Textarea';
export { ThemeScript, themeInitScript, type ThemeScriptProps } from './components/ThemeScript';
export { ThemeToggle, type ThemeToggleProps } from './components/ThemeToggle';
export { Tooltip, type TooltipPlacement, type TooltipProps } from './components/Tooltip';

export {
  ChevronDownIcon,
  CloseIcon,
  DarkThemeIcon,
  ErrorIcon,
  InfoIcon,
  LightThemeIcon,
  SuccessIcon,
  SystemThemeIcon,
  WarningIcon,
  type IconProps,
} from './components/icons';

export { cn } from './lib/cn';
export { mergeStyles, type StyleWithVars } from './lib/style';
export {
  applyTheme,
  isThemeMode,
  nextTheme,
  readStoredTheme,
  THEME_MODES,
  THEME_STORAGE_KEY,
  writeStoredTheme,
  type ThemeMode,
} from './lib/theme';

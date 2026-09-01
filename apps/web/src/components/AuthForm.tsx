'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Alert, Button, Input } from '@toolgraph/ui';

import type { AuthActionState } from '@/app/auth/actions';

export interface AuthFormProps {
  mode: 'login' | 'signup';
  action: (state: AuthActionState, formData: FormData) => Promise<AuthActionState>;
  githubAction: () => Promise<void>;
  /** Surfaced from the OAuth callback via ?error=. */
  initialError?: string;
}

const COPY = {
  login: {
    heading: 'Sign in',
    sub: 'Pick up where you left off.',
    submit: 'Sign in',
    switchPrompt: 'No account yet?',
    switchHref: '/signup',
    switchLabel: 'Create one',
    autoComplete: 'current-password',
  },
  signup: {
    heading: 'Create your account',
    sub: 'Wire MCP tools together, type-checked before they run.',
    submit: 'Create account',
    switchPrompt: 'Already have an account?',
    switchHref: '/login',
    switchLabel: 'Sign in',
    autoComplete: 'new-password',
  },
} as const;

export function AuthForm({ mode, action, githubAction, initialError }: AuthFormProps) {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(action, {
    ...(initialError ? { error: initialError } : {}),
  });
  const copy = COPY[mode];

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold tracking-tight">{copy.heading}</h1>
      <p className="mt-1.5 text-sm text-fg-muted">{copy.sub}</p>

      {state.error ? (
        <div className="mt-5" data-testid="auth-error">
          <Alert variant="error" title="That did not work">
            {state.error}
          </Alert>
        </div>
      ) : null}

      {state.notice ? (
        <div className="mt-5" data-testid="auth-notice">
          <Alert variant="info" title="Check your inbox">
            {state.notice}
          </Alert>
        </div>
      ) : null}

      <form action={formAction} className="mt-6 space-y-4" noValidate>
        <Input
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          required
          data-testid={`${mode}-email`}
          placeholder="you@example.com"
        />
        <Input
          name="password"
          type="password"
          label="Password"
          autoComplete={copy.autoComplete}
          required
          minLength={8}
          data-testid={`${mode}-password`}
          {...(mode === 'signup' ? { hint: 'At least 8 characters.' } : {})}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
          className="w-full"
          data-testid={`${mode}-submit`}
        >
          {copy.submit}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border-subtle" />
        <span className="text-xs text-fg-subtle">or</span>
        <span className="h-px flex-1 bg-border-subtle" />
      </div>

      <form action={githubAction}>
        <Button
          type="submit"
          variant="secondary"
          size="lg"
          className="w-full"
          data-testid="github-submit"
        >
          Continue with GitHub
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-fg-muted">
        {copy.switchPrompt}{' '}
        <Link href={copy.switchHref} className="font-medium text-fg underline underline-offset-2">
          {copy.switchLabel}
        </Link>
      </p>
    </div>
  );
}

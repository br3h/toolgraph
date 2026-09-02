'use client';

import { useRef, useState, useTransition } from 'react';
import { Alert, Button, Input } from '@toolgraph/ui';

import { changePassword } from '@/app/settings/actions';

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setMessage(null);
        startTransition(async () => {
          const result = await changePassword(formData);
          if (result.ok) {
            setMessage({ kind: 'ok', text: result.notice ?? 'Your password has been changed.' });
            // Clearing both fields is the point: a password left in a form is a
            // password sitting in the DOM for the next person at the machine.
            formRef.current?.reset();
          } else {
            setMessage({ kind: 'error', text: result.error ?? 'That could not be changed.' });
          }
        });
      }}
      className="space-y-3"
    >
      {message ? (
        <Alert variant={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</Alert>
      ) : null}

      <Input
        name="currentPassword"
        type="password"
        label="Current password"
        autoComplete="current-password"
        required
      />
      <Input
        name="newPassword"
        type="password"
        label="New password"
        autoComplete="new-password"
        minLength={8}
        required
        hint="At least 8 characters."
      />

      <Button type="submit" variant="secondary" loading={pending}>
        Change password
      </Button>
    </form>
  );
}

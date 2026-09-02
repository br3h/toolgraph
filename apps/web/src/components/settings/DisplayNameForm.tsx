'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Input } from '@toolgraph/ui';

import { updateDisplayName } from '@/app/settings/actions';

export function DisplayNameForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setMessage(null);
        startTransition(async () => {
          const result = await updateDisplayName(formData);
          setMessage(
            result.ok
              ? { kind: 'ok', text: result.notice ?? 'Saved.' }
              : { kind: 'error', text: result.error ?? 'That could not be saved.' },
          );
        });
      }}
      className="space-y-3"
    >
      {message ? (
        <Alert variant={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</Alert>
      ) : null}

      <Input
        name="displayName"
        label="Display name"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={80}
        placeholder="Ada Lovelace"
        hint="Leave it empty to go back to showing your email address."
      />

      <Button type="submit" variant="secondary" loading={pending}>
        Save
      </Button>
    </form>
  );
}

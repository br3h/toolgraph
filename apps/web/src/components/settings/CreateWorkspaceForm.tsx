'use client';

import { useRef, useState, useTransition } from 'react';
import { Alert, Button, Input } from '@toolgraph/ui';

import { createWorkspace } from '@/app/settings/workspaces/actions';

export function CreateWorkspaceForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(formData) => {
        setMessage(null);
        startTransition(async () => {
          const result = await createWorkspace(formData);
          setMessage(
            result.ok
              ? { kind: 'ok', text: result.notice ?? 'Created.' }
              : { kind: 'error', text: result.error ?? 'That could not be created.' },
          );
          if (result.ok) formRef.current?.reset();
        });
      }}
      className="flex w-full flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <Input
          name="name"
          label="Workspace name"
          placeholder="Platform team"
          maxLength={120}
          required
        />
      </div>
      <Button type="submit" variant="primary" loading={pending}>
        Create
      </Button>
      {message ? (
        <div className="w-full sm:order-first">
          <Alert variant={message.kind === 'ok' ? 'success' : 'error'}>{message.text}</Alert>
        </div>
      ) : null}
    </form>
  );
}

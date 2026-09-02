'use client';

import { useState } from 'react';
import { Button } from '@toolgraph/ui';

import { ConnectionDialog } from './ConnectionDialog';

export function NewConnectionButton({
  size = 'sm',
  workspaces,
  credentialStorage,
}: {
  size?: 'sm' | 'md';
  workspaces: readonly { id: string; name: string }[];
  credentialStorage: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} variant="primary" onClick={() => setOpen(true)}>
        Add connection
      </Button>
      <ConnectionDialog
        open={open}
        onClose={() => setOpen(false)}
        workspaces={workspaces}
        credentialStorage={credentialStorage}
      />
    </>
  );
}

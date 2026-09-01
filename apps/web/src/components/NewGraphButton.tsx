'use client';

import { useTransition } from 'react';
import { Button } from '@toolgraph/ui';

import { createGraph } from '@/app/graphs/actions';

export function NewGraphButton({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="primary"
      size={size}
      loading={pending}
      data-testid="new-graph-button"
      onClick={() => startTransition(() => void createGraph())}
    >
      New graph
    </Button>
  );
}

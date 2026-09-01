'use client';

import { useTransition } from 'react';
import { Button } from '@toolgraph/ui';

import { createGraph } from '@/app/graphs/actions';

export interface NewGraphButtonProps {
  size?: 'sm' | 'md' | 'lg';
  /**
   * Only one of these may carry the test id. The graphs page renders the button
   * twice — once in the header, once inside the empty state — and two elements
   * sharing an id makes every selector ambiguous.
   */
  testId?: string | undefined;
}

export function NewGraphButton({ size = 'md', testId }: NewGraphButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="primary"
      size={size}
      loading={pending}
      {...(testId ? { 'data-testid': testId } : {})}
      onClick={() => startTransition(() => void createGraph())}
    >
      New graph
    </Button>
  );
}

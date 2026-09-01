import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  TimeoutError,
  withTimeout,
} from './timeouts';

afterEach(() => {
  vi.useRealTimers();
});

describe('defaults', () => {
  it('are finite, positive and ordered sensibly', () => {
    expect(DEFAULT_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TOOL_CALL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_TOTAL_TIMEOUT_MS).toBeGreaterThanOrEqual(DEFAULT_CONNECT_TIMEOUT_MS);
  });
});

describe('withTimeout', () => {
  it('passes a value through when the work wins', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000, 'work')).resolves.toBe('ok');
  });

  it('passes a rejection through unchanged', async () => {
    const boom = new Error('boom');
    await expect(withTimeout(Promise.reject(boom), 1_000, 'work')).rejects.toBe(boom);
  });

  it('rejects with a TimeoutError when the deadline wins', async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 5, 'a handshake')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('describes what timed out', async () => {
    const never = new Promise<never>(() => {});
    const error = await withTimeout(never, 5, 'a handshake').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    const timeout = error as TimeoutError;
    expect(timeout.name).toBe('TimeoutError');
    expect(timeout.label).toBe('a handshake');
    expect(timeout.timeoutMs).toBe(5);
    expect(timeout.message).toContain('a handshake');
    expect(timeout.message).toContain('5');
  });

  it('clears its timer when the work resolves first', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(1), 60_000, 'work')).resolves.toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the work rejects first', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.reject(new Error('no')), 60_000, 'work')).rejects.toThrow(
      'no',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the deadline fires', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => {}), 1_000, 'work');
    const settled = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1_000);
    await settled;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not fire early', async () => {
    vi.useFakeTimers();
    let outcome: string | undefined;
    const pending = withTimeout(new Promise<never>(() => {}), 1_000, 'work').catch(() => {
      outcome = 'timed out';
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toBe('timed out');
  });

  it('treats a non-positive or non-finite deadline as immediate', async () => {
    for (const ms of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = await withTimeout(new Promise<never>(() => {}), ms, 'work').catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).timeoutMs).toBe(0);
    }
  });
});

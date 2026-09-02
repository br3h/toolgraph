'use server';

/**
 * Connection mutations.
 *
 * Ownership is enforced by RLS, not by anything in this file. The checks here
 * exist to produce a good error message; treating them as the security boundary
 * is how a filter-shaped bug gets written.
 *
 * The one exception is the credential, which lives in a table RLS cannot help
 * with because `authenticated` has no grant on it at all. That path goes
 * through `lib/connections/store.ts`, which performs a scoped-client ownership
 * read before every admin-client write.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { McpToolDescriptor } from '@toolgraph/schema-core';

import { createClient } from '@/lib/supabase/server';
import { guardAction } from '@/lib/actions-guard';
import {
  clearCredential,
  getCachedTools,
  recordHealth,
  setCredential,
} from '@/lib/connections/store';
import { credentialStorageConfigured } from '@/lib/crypto';

export interface ConnectionActionResult {
  ok: boolean;
  error?: string;
  id?: string;
  /** Set when the write succeeded but a non-fatal part of it did not. */
  warning?: string;
}

const uuid = z.string().uuid('That is not a valid connection id.');

/**
 * The URL rules the DATABASE cannot express and the engine enforces later.
 *
 * This is a usability check, not a security control: the SSRF guard in
 * `@toolgraph/mcp-client` is what actually decides whether a host may be
 * dialled, it runs in the engine after DNS resolution, and nothing here may be
 * relied on in its place. Rejecting an obviously wrong scheme at the form is
 * simply better than making someone wait for a round trip to be told.
 */
const httpUrl = z
  .string()
  .trim()
  .min(1, 'A URL is required for this transport.')
  .max(2048, 'That URL is too long.')
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'The URL must start with http:// or https://.',
  });

const connectionInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Give this connection a name.')
      .max(120, 'That name is too long.'),
    transport: z.enum(['stdio', 'sse', 'http']),
    url: z.string().trim().max(2048).optional(),
    command: z.string().trim().max(500).optional(),
    args: z.array(z.string().max(500)).max(50).default([]),
    workspaceId: z.string().uuid().nullable().default(null),
  })
  .superRefine((value, ctx) => {
    // Mirrors mcp_server_connections_transport_target_check. The database is
    // still the enforcer; this turns a constraint violation into a field error.
    if (value.transport === 'stdio') {
      if (!value.command) {
        ctx.addIssue({
          code: 'custom',
          path: ['command'],
          message: 'A stdio server needs a command.',
        });
      }
    } else if (!value.url) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'This transport needs a URL.' });
    } else {
      const parsed = httpUrl.safeParse(value.url);
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['url'],
          message: parsed.error.issues[0]?.message ?? 'Invalid URL.',
        });
      }
    }
  });

export type ConnectionInput = z.input<typeof connectionInput>;

/**
 * The credential, kept out of `connectionInput` on purpose.
 *
 * It travels separately end to end — separate field, separate table, separate
 * client — so there is no code path in which it could be spread into a row
 * insert alongside the rest of the form.
 */
const credentialInput = z.string().trim().max(4096).optional();

export async function createConnection(
  input: ConnectionInput,
  credential?: string,
): Promise<ConnectionActionResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsed = connectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const parsedCredential = credentialInput.safeParse(credential);
  if (!parsedCredential.success) return { ok: false, error: 'That credential is too long.' };

  const value = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('mcp_server_connections')
    .insert({
      owner: guard.user.id,
      name: value.name,
      transport: value.transport,
      url: value.transport === 'stdio' ? null : (value.url ?? null),
      command: value.transport === 'stdio' ? (value.command ?? null) : null,
      args: value.transport === 'stdio' ? value.args : [],
      workspace_id: value.workspaceId,
      provider: 'mcp',
    })
    .select('id')
    .single();

  if (error || !data) {
    // 23505 is the per-scope unique index on (owner, name) / (workspace_id, name).
    const message =
      error?.code === '23505'
        ? 'You already have a connection with that name.'
        : 'That connection could not be saved.';
    return { ok: false, error: message };
  }

  const id = data.id as string;

  // A failed credential write must not orphan a connection the user can see was
  // created. Report it as a warning and let them retry from the edit form.
  if (parsedCredential.data) {
    if (!credentialStorageConfigured()) {
      return {
        ok: true,
        id,
        warning:
          'The connection was saved, but this deployment cannot store credentials, so the authorization header was not kept. You will be asked for it each time you test.',
      };
    }
    try {
      await setCredential(id, 'headers', parsedCredential.data);
    } catch {
      return {
        ok: true,
        id,
        warning: 'The connection was saved, but its credential could not be stored.',
      };
    }
  }

  revalidatePath('/connections');
  return { ok: true, id };
}

export async function updateConnection(
  id: string,
  input: ConnectionInput,
  credential?: string,
  /** True when the user asked to remove a stored credential. */
  removeCredential = false,
): Promise<ConnectionActionResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const parsed = connectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const value = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase
    .from('mcp_server_connections')
    .update({
      name: value.name,
      transport: value.transport,
      url: value.transport === 'stdio' ? null : (value.url ?? null),
      command: value.transport === 'stdio' ? (value.command ?? null) : null,
      args: value.transport === 'stdio' ? value.args : [],
      workspace_id: value.workspaceId,
      // The target moved, so what we knew about its health no longer applies.
      // Leaving a green dot next to a URL that was just changed is exactly the
      // kind of stale reassurance this status field exists to avoid.
      status: 'untested',
      last_error: null,
      tools_cache: null,
      tool_count: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsedId.data);

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? 'You already have a connection with that name.'
          : 'That connection could not be updated.',
    };
  }

  try {
    if (removeCredential) {
      await clearCredential(parsedId.data);
    } else if (credential?.trim()) {
      await setCredential(parsedId.data, 'headers', credential.trim());
    }
  } catch (caught) {
    return {
      ok: true,
      id: parsedId.data,
      warning: caught instanceof Error ? caught.message : 'The credential could not be updated.',
    };
  }

  revalidatePath('/connections');
  revalidatePath(`/connections/${parsedId.data}`);
  return { ok: true, id: parsedId.data };
}

export async function deleteConnection(id: string): Promise<ConnectionActionResult> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const supabase = await createClient();
  // The credential row is removed by `on delete cascade`, so there is no second
  // delete to forget here and no window in which a secret outlives its
  // connection.
  const { error } = await supabase.from('mcp_server_connections').delete().eq('id', parsedId.data);

  if (error) return { ok: false, error: 'That connection could not be removed.' };

  revalidatePath('/connections');
  return { ok: true };
}

/**
 * Persist the outcome of a test the browser performed against the engine.
 *
 * The browser talks to the engine directly (it holds the user's access token
 * and the engine streams), so the result comes back here to be recorded rather
 * than the server making the call itself. That means the input is
 * attacker-controlled, and the important consequence is: this can only ever set
 * health on a connection the CALLER can already see, and the worst a lie
 * achieves is a wrong dot on their own dashboard. Nothing downstream trusts
 * `tools_cache` for execution — every run re-introspects.
 */
export async function recordConnectionTest(
  id: string,
  outcome: { ok: true; tools: McpToolDescriptor[] } | { ok: false; error: string },
): Promise<ConnectionActionResult> {
  const guard = await guardAction('connectionTest');
  if (!guard.ok) return { ok: false, error: guard.error };

  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  // Bound what gets written. A malicious or broken engine response must not be
  // able to put an unbounded blob into a jsonb column.
  const safeOutcome = outcome.ok
    ? { ok: true as const, tools: outcome.tools.slice(0, 500) }
    : { ok: false as const, error: String(outcome.error).slice(0, 500) };

  await recordHealth(parsedId.data, safeOutcome);

  revalidatePath('/connections');
  revalidatePath(`/connections/${parsedId.data}`);
  return { ok: true, id: parsedId.data };
}

/**
 * The cached tool schemas for one saved connection.
 *
 * Split out from the graph page's initial load on purpose. A cached tool set is
 * every tool's full JSON Schema; sending twenty connections' worth into every
 * graph page would be megabytes paid on every open, to populate a picker most
 * visits never touch. This costs one round trip on an explicit click instead.
 *
 * Ownership is the scoped client's to decide: `getCachedTools` reads through
 * RLS, so a connection the caller cannot see returns an empty list — the same
 * answer as one that has never been tested, which is deliberately not an oracle
 * for whether the id exists.
 */
export async function loadConnectionTools(
  id: string,
): Promise<{ ok: boolean; tools: McpToolDescriptor[]; error?: string }> {
  const guard = await guardAction('connectionWrite');
  if (!guard.ok) return { ok: false, tools: [], error: guard.error };

  const parsedId = uuid.safeParse(id);
  if (!parsedId.success) return { ok: false, tools: [], error: parsedId.error.issues[0]?.message };

  return { ok: true, tools: await getCachedTools(parsedId.data) };
}

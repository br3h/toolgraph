'use server';

/**
 * Saved-graph mutations.
 *
 * Every one of these acts as the signed-in user through the RLS-scoped client,
 * so the database — not this file — is what actually enforces ownership. The
 * `owner` checks here produce good error messages; they are not the security
 * boundary, and must never be treated as one.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ToolGraphDocument } from '@toolgraph/schema-core';

import { createClient, getCurrentUser } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/public-env';
import { emptyDocument, graphDocumentSchema } from '@/lib/graph-document';

export interface GraphActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Same-origin check on top of the framework's own, as with the auth actions. */
async function assertSameOrigin(): Promise<string | null> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  if (!origin) {
    return process.env.NODE_ENV === 'production' ? 'This request could not be verified.' : null;
  }

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    /* ignored */
  }
  const host = headerList.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    if (process.env.NODE_ENV !== 'production') allowed.add(`http://${host}`);
  }
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);

  return allowed.has(origin) ? null : 'This request could not be verified.';
}

const titleSchema = z
  .string()
  .trim()
  .min(1, 'A graph needs a name.')
  .max(200, 'That name is too long.');

const uuidSchema = z.string().uuid('That is not a valid graph id.');

export async function createGraph(): Promise<GraphActionResult> {
  const originError = await assertSameOrigin();
  if (originError) return { ok: false, error: originError };

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('graphs')
    .insert({ owner: user.id, title: 'Untitled graph', graph_json: emptyDocument() })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Could not create the graph.' };
  }

  revalidatePath('/graphs');
  redirect(`/graphs/${data.id}`);
}

export async function renameGraph(id: string, title: string): Promise<GraphActionResult> {
  const originError = await assertSameOrigin();
  if (originError) return { ok: false, error: originError };

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const parsedTitle = titleSchema.safeParse(title);
  if (!parsedTitle.success) return { ok: false, error: parsedTitle.error.issues[0]?.message };

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { error } = await supabase
    .from('graphs')
    .update({ title: parsedTitle.data })
    .eq('id', parsedId.data);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/graphs');
  revalidatePath(`/graphs/${id}`);
  return { ok: true };
}

export async function saveGraph(
  id: string,
  document: ToolGraphDocument,
): Promise<GraphActionResult> {
  const originError = await assertSameOrigin();
  if (originError) return { ok: false, error: originError };

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  // Never write an unvalidated blob into the column — everything that reads it
  // later, including the engine, trusts that it has this shape.
  const parsedDocument = graphDocumentSchema.safeParse(document);
  if (!parsedDocument.success) {
    return { ok: false, error: 'That graph could not be saved because it is malformed.' };
  }

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { error } = await supabase
    .from('graphs')
    .update({ graph_json: parsedDocument.data, updated_at: new Date().toISOString() })
    .eq('id', parsedId.data);

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: parsedId.data };
}

export async function duplicateGraph(id: string): Promise<GraphActionResult> {
  const originError = await assertSameOrigin();
  if (originError) return { ok: false, error: originError };

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  // RLS scopes this select to the caller, so a graph they do not own simply
  // is not found — there is no separate ownership check to get wrong.
  const { data: source, error: readError } = await supabase
    .from('graphs')
    .select('title, graph_json')
    .eq('id', parsedId.data)
    .single();

  if (readError || !source) return { ok: false, error: 'That graph could not be found.' };

  const { data, error } = await supabase
    .from('graphs')
    .insert({
      owner: user.id,
      title: `${String(source.title).slice(0, 190)} (copy)`,
      graph_json: source.graph_json,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not duplicate.' };

  revalidatePath('/graphs');
  return { ok: true, id: data.id };
}

export async function deleteGraph(id: string): Promise<GraphActionResult> {
  const originError = await assertSameOrigin();
  if (originError) return { ok: false, error: originError };

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: parsedId.error.issues[0]?.message };

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const { error } = await supabase.from('graphs').delete().eq('id', parsedId.data);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/graphs');
  return { ok: true };
}

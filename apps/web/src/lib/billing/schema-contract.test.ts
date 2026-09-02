/**
 * The billing route writes columns that must actually exist.
 *
 * This suite exists because of a real, silent, money-losing bug that shipped to
 * production: `POST /api/billing/submit` wrote `reason`, `usd_value` and
 * `reviewed_at`, while `public.payment_submissions` has `failure_reason`,
 * `usd_at_verification` and `verified_at`. Every update failed. Because the
 * failure was caught and returned as `false`, two things happened quietly —
 *
 *   * a payment that verified on-chain never activated a subscription; and
 *   * a rejected claim was never marked rejected, so the retry path (which
 *     matches on `status = 'rejected'`) could never fire, and the unique
 *     (currency, tx_hash) index blocked that hash for that account forever.
 *
 * Nothing in a type system catches this: PostgREST takes column names as
 * strings and the client types are `any`-shaped at that boundary. So the check
 * is textual and deliberately crude — it reads the migration for the real
 * column set and the route for the names it writes, and demands the second be a
 * subset of the first. Crude is fine; the bug it prevents cost real payments.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// apps/web/src/lib/billing -> repo root
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

/**
 * Strips `--` comments before any statement is split on `;`.
 *
 * Not optional: these migrations are heavily commented and prose contains
 * semicolons. Without this, a statement's extent is decided by the first
 * semicolon in an explanatory sentence rather than by the end of the statement,
 * and columns declared after it vanish — which made this very suite report a
 * column that does exist as missing.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * Column names for one `create table` block, plus any added later by
 * `alter table ... add column if not exists`. Both are needed: the base
 * columns are in one migration and the plan/interval/seat columns in another.
 */
function columnsOf(table: string): Set<string> {
  const sql = stripSqlComments(
    [
      read('supabase', 'migrations', '20260103000000_subscriptions.sql'),
      read('supabase', 'migrations', '20260201000300_billing_plans.sql'),
    ].join('\n'),
  );

  const columns = new Set<string>();

  const createMatch = new RegExp(
    `create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    'i',
  ).exec(sql);

  if (createMatch?.[1]) {
    for (const line of createMatch[1].split('\n')) {
      // A column definition starts with an identifier at the beginning of the
      // line; constraints start with `constraint`, `primary`, `unique` etc.
      const column = /^\s{2}([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
      if (
        column?.[1] &&
        !['constraint', 'primary', 'unique', 'check', 'foreign'].includes(column[1])
      ) {
        columns.add(column[1]);
      }
    }
  }

  const alterBlocks = sql.matchAll(new RegExp(`alter table public\\.${table}([\\s\\S]*?);`, 'gi'));
  for (const block of alterBlocks) {
    for (const added of (block[1] ?? '').matchAll(
      /add column if not exists\s+([a-z_][a-z0-9_]*)/gi,
    )) {
      if (added[1]) columns.add(added[1]);
    }
  }

  return columns;
}

/**
 * Column names a module writes, extracted by actually parsing the object
 * literals rather than by guessing at a naming convention.
 *
 * An earlier version of this matched snake_case identifiers, which missed the
 * single-word half of the original bug entirely: the route wrote `reason`, and
 * a convention-based matcher has no way to tell that from a local variable. So
 * this finds each `.insert(`, `.update(` or `.upsert(` call, walks the braces to
 * find the extent of its first argument, and takes the keys at depth 1. Those
 * are columns by construction.
 *
 * `patch.x = ...` assignments are picked up separately, because the route builds
 * one write object conditionally.
 */
function writtenColumns(source: string): Set<string> {
  const written = new Set<string>();

  for (const call of source.matchAll(/\.(?:insert|update|upsert)\(\s*\{/g)) {
    // Position of the `{` that opens the argument.
    const open = source.indexOf('{', call.index);
    if (open === -1) continue;

    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      const char = source[i];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;

    const body = source.slice(open + 1, end);

    // Keys at depth 1 only. A nested object is an option bag (`{ onConflict }`)
    // or a jsonb value, and neither names a column of this table.
    let nested = 0;
    for (const line of body.split('\n')) {
      if (nested === 0) {
        const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
        if (key?.[1]) written.add(key[1]);
      }
      for (const char of line) {
        if (char === '{' || char === '[') nested += 1;
        else if (char === '}' || char === ']') nested -= 1;
      }
    }
  }

  for (const match of source.matchAll(/patch\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
    if (match[1]) written.add(match[1]);
  }
  // The route builds its update body as a `Record<string, unknown>` literal
  // assigned to `patch`, whose keys are columns too.
  const patchLiteral = /const patch: Record<string, unknown> = \{([\s\S]*?)\n\s*\};/.exec(source);
  if (patchLiteral?.[1]) {
    for (const line of patchLiteral[1].split('\n')) {
      const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
      if (key?.[1]) written.add(key[1]);
    }
  }

  return written;
}

describe('payment_submissions column contract', () => {
  const schema = columnsOf('payment_submissions');
  const route = read('apps', 'web', 'src', 'app', 'api', 'billing', 'submit', 'route.ts');

  it('finds the columns in the migration at all', () => {
    // Guards the guard: if the regex above stops matching, every assertion
    // below would pass vacuously against an empty set.
    expect(schema.size).toBeGreaterThan(8);
    expect(schema).toContain('failure_reason');
    expect(schema).toContain('usd_at_verification');
    expect(schema).toContain('verified_at');
    expect(schema).toContain('expected_usd');
  });

  it('does not have the columns the route used to write', () => {
    // The exact bug. If someone reintroduces these names, the test that fails
    // is this one, with the history above to explain why.
    expect(schema.has('reason')).toBe(false);
    expect(schema.has('usd_value')).toBe(false);
    expect(schema.has('reviewed_at')).toBe(false);
  });

  it('only writes columns that exist', () => {
    const unknown = [...writtenColumns(route)].filter((column) => !schema.has(column));
    expect(
      unknown,
      `The billing route writes ${unknown.join(', ')}, which payment_submissions does not have. ` +
        'A PostgREST write to a non-existent column fails silently here — see the header of this file.',
    ).toEqual([]);
  });
});

describe('subscriptions column contract', () => {
  const schema = columnsOf('subscriptions');
  const module = read('apps', 'web', 'src', 'lib', 'billing', 'subscription.ts');

  it('has the plan columns the product now sells', () => {
    expect(schema).toContain('plan');
    expect(schema).toContain('billing_interval');
    expect(schema).toContain('seats');
    expect(schema).toContain('workspace_id');
    expect(schema).toContain('current_period_end');
  });

  it('only writes columns that exist', () => {
    const unknown = [...writtenColumns(module)].filter((column) => !schema.has(column));
    expect(unknown, `subscription.ts writes unknown columns: ${unknown.join(', ')}`).toEqual([]);
  });
});

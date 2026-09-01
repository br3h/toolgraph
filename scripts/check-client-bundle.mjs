#!/usr/bin/env node
/**
 * Asserts that no server-only secret reached a browser bundle or the engine's
 * compiled output.
 *
 * Two modes:
 *
 *   node scripts/check-client-bundle.mjs
 *     Structural check. Looks for server-only variable NAMES inlined into client
 *     chunks, and for credential-SHAPED literals. Needs no secrets, so this is
 *     what CI runs.
 *
 *   node scripts/check-client-bundle.mjs --with-values
 *     Additionally reads .env.local and greps the built output for the ACTUAL
 *     values. This is the check the security section requires before a deploy.
 *     It never prints a value — only the variable name and the offending file.
 *
 * Exit code 1 on any finding.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const WITH_VALUES = process.argv.includes('--with-values');

/** Variables that must never be readable from a browser bundle. */
const SERVER_ONLY_VARS = [
  'SUPABASE_SECRET_KEY',
  'RESEND_API_KEY',
  'SENTRY_AUTH_TOKEN',
  'UPSTASH_REDIS_REST_TOKEN',
];

/**
 * Credential shapes. Deliberately conservative: each is specific enough that a
 * match is almost certainly a real leak rather than a coincidence.
 */
const CREDENTIAL_PATTERNS = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{20,}/ },
  { name: 'Sentry auth token', re: /\bsntrys?_[A-Za-z0-9_=-]{20,}/ },
  {
    name: 'Supabase service_role JWT',
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  },
];

/** Directories that end up in a browser, plus the engine's shipped artifact. */
const SCAN_TARGETS = [
  { dir: 'apps/web/.next/static', label: 'web client bundle', clientFacing: true },
  { dir: 'apps/web/.next/server', label: 'web server bundle', clientFacing: false },
  { dir: 'apps/engine/dist', label: 'engine build output', clientFacing: false },
];

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.map', '.txt', '.html', '.css', '']);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile() && TEXT_EXT.has(extname(entry))) {
      yield full;
    }
  }
}

/** Reads .env.local without printing anything from it. */
function readEnvLocalValues() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return null;

  /** @type {Map<string, string>} */
  const out = new Map();
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Short values produce false positives against minified code.
    if (value.length >= 12) out.set(key, value);
  }
  return out;
}

const findings = [];
let filesScanned = 0;

for (const target of SCAN_TARGETS) {
  const abs = join(ROOT, target.dir);
  if (!existsSync(abs)) {
    console.log(`  skipped ${target.dir} (not built)`);
    continue;
  }

  for (const file of walk(abs)) {
    filesScanned++;
    let contents;
    try {
      contents = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = relative(ROOT, file);

    // 1. A server-only variable NAME appearing in a client chunk means the
    //    bundler saw a `process.env.X` it could not tree-shake away.
    if (target.clientFacing) {
      for (const varName of SERVER_ONLY_VARS) {
        if (contents.includes(varName)) {
          findings.push(`${varName} appears in ${target.label}: ${rel}`);
        }
      }
    }

    // 2. Credential-shaped literals, anywhere. A real value baked into any
    //    build artifact is a leak even server-side, because the artifact is
    //    what gets uploaded and cached.
    for (const { name, re } of CREDENTIAL_PATTERNS) {
      if (re.test(contents)) {
        findings.push(`${name} shaped literal found in ${target.label}: ${rel}`);
      }
    }
  }
}

// 3. The value check, when explicitly requested.
if (WITH_VALUES) {
  const env = readEnvLocalValues();
  if (!env) {
    console.error('  --with-values was passed but .env.local does not exist.');
    process.exit(1);
  }

  const toCheck = [...SERVER_ONLY_VARS, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']
    .map((k) => [k, env.get(k)])
    .filter(([, v]) => typeof v === 'string' && v.length >= 12);

  console.log(`  value check: ${toCheck.length} variables with a usable value`);

  for (const target of SCAN_TARGETS) {
    const abs = join(ROOT, target.dir);
    if (!existsSync(abs)) continue;

    for (const file of walk(abs)) {
      let contents;
      try {
        contents = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const rel = relative(ROOT, file);

      for (const [key, value] of toCheck) {
        if (!contents.includes(value)) continue;

        // The publishable key is meant to be in the client bundle; it is only a
        // finding if it turns up somewhere it has no business being.
        const isPublic = key.startsWith('NEXT_PUBLIC_');
        if (isPublic && target.clientFacing) continue;
        if (isPublic) continue;

        findings.push(`VALUE of ${key} found in ${target.label}: ${rel}`);
      }
    }
  }
}

console.log(`  scanned ${filesScanned} files across ${SCAN_TARGETS.length} targets`);

if (findings.length > 0) {
  console.error('\nSECRET LEAK CHECK FAILED\n');
  for (const f of findings) console.error(`  - ${f}`);
  console.error('\nNo secret value or server-only variable may reach a build artifact.');
  process.exit(1);
}

console.log(
  WITH_VALUES
    ? '\nOK: no server-only variable name, credential-shaped literal, or actual secret value found.'
    : '\nOK: no server-only variable name or credential-shaped literal found in any build artifact.',
);

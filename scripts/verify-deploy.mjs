#!/usr/bin/env node
/**
 * Polls a health endpoint until it reports the commit we just merged.
 *
 * A deploy is not "done" because a provider's UI said so — it is done when the
 * URL a user hits is serving the new code. This is what proves that.
 *
 * Usage:
 *   node scripts/verify-deploy.mjs --name web --url https://.../api/health \
 *     --commit <sha> [--fallback <url>] [--timeout-seconds 900] [--cold-start]
 */

function arg(flag, fallback = undefined) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (flag) => process.argv.includes(flag);

const name = arg('--name', 'service');
const primaryUrl = arg('--url');
const fallbackUrl = arg('--fallback');
const wantCommit = arg('--commit', '');
const timeoutSeconds = Number(arg('--timeout-seconds', '900'));
const coldStart = has('--cold-start');

if (!primaryUrl) {
  console.error('--url is required');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url) {
  const controller = new AbortController();
  // A sleeping Render service can take the better part of a minute to answer.
  const timer = setTimeout(() => controller.abort(), coldStart ? 75_000 : 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'toolgraph-deploy-verify' },
      cache: 'no-store',
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* a non-JSON body is itself a signal that something is wrong */
    }
    return { ok: res.ok, status: res.status, body, raw: text.slice(0, 300) };
  } catch (err) {
    return { ok: false, status: 0, body: null, raw: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** A short SHA in the health payload should still count as a match. */
function commitMatches(reported, expected) {
  if (!reported || !expected) return false;
  const a = String(reported).toLowerCase();
  const b = String(expected).toLowerCase();
  return a.startsWith(b) || b.startsWith(a);
}

const candidates = [primaryUrl, fallbackUrl].filter((u) => typeof u === 'string' && u.length > 0);

const deadline = Date.now() + timeoutSeconds * 1000;
let attempt = 0;
let lastReport = 'no response yet';

console.log(`Verifying ${name} is serving commit ${wantCommit.slice(0, 12)}...`);
console.log(`  candidates: ${candidates.join(', ')}`);

while (Date.now() < deadline) {
  attempt++;

  for (const url of candidates) {
    const result = await probe(url);

    if (!result.ok) {
      lastReport = `${url} -> HTTP ${result.status} ${result.raw}`;
      continue;
    }

    const reported = result.body?.commit ?? result.body?.sha ?? null;

    if (!wantCommit) {
      console.log(`OK: ${name} is healthy at ${url} (no commit assertion requested).`);
      process.exit(0);
    }

    if (commitMatches(reported, wantCommit)) {
      console.log(`OK: ${name} at ${url} is serving ${String(reported).slice(0, 12)}.`);
      process.exit(0);
    }

    lastReport =
      `${url} -> healthy but serving ` +
      `${reported ? String(reported).slice(0, 12) : 'an unreported commit'}, ` +
      `waiting for ${wantCommit.slice(0, 12)}`;
  }

  const elapsed = Math.round((timeoutSeconds * 1000 - (deadline - Date.now())) / 1000);
  console.log(`  attempt ${attempt} (${elapsed}s elapsed): ${lastReport}`);

  // Back off gently: fast at first while a deploy is likely finishing, then
  // slower so a 15-minute wait is not thousands of requests.
  await sleep(Math.min(15_000, 3_000 + attempt * 1_000));
}

console.error(
  `\nFAILED: ${name} did not report commit ${wantCommit.slice(0, 12)} within ${timeoutSeconds}s.`,
);
console.error(`  last observation: ${lastReport}`);
console.error('\nThis usually means the provider build failed, or the health endpoint is not');
console.error('reporting the deployed commit. Check the provider dashboard before retrying.');
process.exit(1);

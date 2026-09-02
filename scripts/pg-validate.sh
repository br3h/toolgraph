#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres, from scratch, in order.
# Docker is not always available on a developer machine and the Supabase CLI
# needs it; this catches SQL that does not parse or does not apply long before
# CI's real Supabase job does. It is NOT a substitute for that job — the stubs
# below are not Supabase's auth schema.
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${PGTEST_DIR:?set PGTEST_DIR}"
psql -h 127.0.0.1 -p 55432 -U postgres -q -c "drop database if exists tg;" -c "create database tg;" >/dev/null 2>&1
psql -h 127.0.0.1 -p 55432 -U postgres -d tg -v ON_ERROR_STOP=1 -q -f "$SCRATCH/bootstrap.sql" >/dev/null
fail=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  if out=$(psql -h 127.0.0.1 -p 55432 -U postgres -d tg -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    echo "OK   $(basename "$f")"
  else
    echo "FAIL $(basename "$f")"; echo "$out" | grep -E "ERROR|LINE|HINT" | head -10; fail=1
  fi
done
# Idempotence: every migration must survive being applied twice.
for f in "$ROOT"/supabase/migrations/*.sql; do
  if ! out=$(psql -h 127.0.0.1 -p 55432 -U postgres -d tg -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    echo "FAIL (rerun) $(basename "$f")"; echo "$out" | grep -E "ERROR|LINE|HINT" | head -10; fail=1
  fi
done
[ $fail -eq 0 ] && echo "--- all migrations apply, and re-apply, cleanly ---"
exit $fail

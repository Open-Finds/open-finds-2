#!/usr/bin/env bash
# Concurrency check for claim_ai_save_attempt, using real parallel database sessions.
# Requires docker. Not part of ./supabase/tests/run.sh and not run in CI.
#
#   ./supabase/tests/ai_save_attempts_concurrency.sh
#
# supabase/tests/10_ai_save_attempts.sql checks the counting rules in one session.
# This checks the part a single session cannot: that simultaneous claims by the same
# user cannot both take the last slot or the last request, because each claim takes
# a per-user lock. Every claim here is its own `psql` process, so they truly overlap.
#
# NOTE: written for the throwaway-container pattern of run.sh. It had not been run
# when it was added (no Docker was available); run it once before relying on it.
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="${POSTGRES_IMAGE:-postgres:17-alpine}"
NAME="of2-attempts-$$"
DB=verify
PARALLEL="${PARALLEL:-40}"
TMP="$(mktemp -d)"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "→ starting $IMAGE"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres "$IMAGE" >/dev/null
ready=false
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[ "$ready" = true ] || { echo "Postgres did not become ready" >&2; docker logs "$NAME" >&2; exit 1; }

psql_in() { docker exec "$NAME" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -t -A "$@"; }

docker exec "$NAME" psql -U postgres -q -c "CREATE DATABASE $DB;" >/dev/null
docker cp supabase/tests/00_platform_stub.sql "$NAME":/tmp/stub.sql >/dev/null
docker cp supabase/migrations/20261117130000_ai_save_attempt_allowance.sql "$NAME":/tmp/attempts.sql >/dev/null
psql_in -f /tmp/stub.sql >/dev/null
psql_in -f /tmp/attempts.sql >/dev/null
psql_in -c "INSERT INTO auth.users (id, email) VALUES
  ('c0c0c0c0-0000-0000-0000-000000000001', 'a@x.com'),
  ('c0c0c0c0-0000-0000-0000-000000000002', 'b@x.com'),
  ('c0c0c0c0-0000-0000-0000-000000000003', 'c@x.com');" >/dev/null

U1=c0c0c0c0-0000-0000-0000-000000000001
U2=c0c0c0c0-0000-0000-0000-000000000002
U3=c0c0c0c0-0000-0000-0000-000000000003
fails=0

# $1 = label, $2 = file of results, $3 = expected number of "true"
check() {
  local got
  got=$(grep -c '^true$' "$2" || true)
  if [ "$got" = "$3" ]; then echo "PASS  $1 (admitted $got)"; else echo "FAIL  $1 (admitted $got, expected $3)"; fails=1; fi
}

# 1. PARALLEL simultaneous NEW attempts from one user, limit 20: exactly 20 admitted.
for i in $(seq 1 "$PARALLEL"); do
  psql_in -c "SELECT (public.claim_ai_save_attempt('$U1', gen_random_uuid()))->>'allowed'" >"$TMP/new.$i" &
done
wait
cat "$TMP"/new.* >"$TMP/new.all"
check "$PARALLEL simultaneous new attempts, limit 20" "$TMP/new.all" 20
count=$(psql_in -c "SELECT count(*) FROM public.ai_save_attempts WHERE user_id = '$U1'")
[ "$count" = "20" ] && echo "PASS  exactly 20 attempts recorded" || { echo "FAIL  $count attempts recorded, expected 20"; fails=1; }

# 2. 30 simultaneous requests of ONE attempt, per-attempt cap 12: exactly 12 admitted, one attempt recorded.
ATTEMPT=d0d0d0d0-0000-0000-0000-000000000001
for i in $(seq 1 30); do
  psql_in -c "SELECT (public.claim_ai_save_attempt('$U2', '$ATTEMPT'))->>'allowed'" >"$TMP/one.$i" &
done
wait
cat "$TMP"/one.* >"$TMP/one.all"
check "30 simultaneous requests of one attempt, cap 12" "$TMP/one.all" 12
rows=$(psql_in -c "SELECT count(*) || ':' || max(requests) FROM public.ai_save_attempts WHERE user_id = '$U2'")
[ "$rows" = "1:12" ] && echo "PASS  one attempt recorded with 12 requests" || { echo "FAIL  recorded $rows, expected 1:12"; fails=1; }

# 3. Another user is unaffected by a full allowance: while the first user (already at the limit)
# keeps trying, a second user's 20 simultaneous attempts are all admitted and none of the first user's are.
for i in $(seq 1 20); do
  psql_in -c "SELECT (public.claim_ai_save_attempt('$U3', gen_random_uuid()))->>'allowed'" >"$TMP/u3.$i" &
  psql_in -c "SELECT (public.claim_ai_save_attempt('$U1', gen_random_uuid()))->>'allowed'" >"$TMP/u1more.$i" &
done
wait
cat "$TMP"/u3.* >"$TMP/u3.all"
cat "$TMP"/u1more.* >"$TMP/u1more.all"
check "20 simultaneous attempts by a second user" "$TMP/u3.all" 20
check "none of the first user's extra attempts admitted at the limit" "$TMP/u1more.all" 0

[ $fails -eq 0 ] && echo "→ all concurrency assertions passed" || { echo "→ FAILURES"; exit 1; }

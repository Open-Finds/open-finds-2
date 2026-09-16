#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres and asserts the security
# properties of the M01 hardening. Requires docker.
#
#   ./supabase/tests/run.sh
#
# The stub stands in for the Supabase platform objects the migrations depend on
# (auth.uid(), auth.users, the anon/authenticated roles) so the chain can run
# against plain Postgres. It is a test fixture, never applied to a real project.
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="${POSTGRES_IMAGE:-postgres:17-alpine}"
NAME="of2-rlstest-$$"
DB=verify

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ starting $IMAGE"
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker exec "$NAME" psql -U postgres -q -c "CREATE DATABASE $DB;" >/dev/null
docker cp supabase/tests/00_platform_stub.sql "$NAME":/tmp/stub.sql >/dev/null
docker exec "$NAME" psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f /tmp/stub.sql >/dev/null

echo "→ applying migrations"
docker exec "$NAME" mkdir -p /tmp/mig
for f in supabase/migrations/*.sql; do
  docker cp "$f" "$NAME":/tmp/mig/"$(basename "$f")" >/dev/null
  if ! docker exec "$NAME" psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f /tmp/mig/"$(basename "$f")" >/tmp/mig_err 2>&1; then
    echo "  ✗ $(basename "$f")"; grep ERROR /tmp/mig_err | head -3; exit 1
  fi
done
echo "  ✓ $(ls supabase/migrations/*.sql | wc -l) migrations applied"

echo "→ asserting security properties"
fails=0
for t in supabase/tests/0[1234]_*.sql; do
  docker cp "$t" "$NAME":/tmp/"$(basename "$t")" >/dev/null
  out=$(docker exec "$NAME" psql -U postgres -d $DB -q -t -A -f /tmp/"$(basename "$t")" 2>&1 \
        | grep -E 'PASS|FAIL|ERROR' | sed 's/^psql.*NOTICE:  //')
  echo "$out"
  echo "$out" | grep -q 'FAIL\|ERROR' && fails=1
done

[ $fails -eq 0 ] && echo "→ all assertions passed" || { echo "→ FAILURES"; exit 1; }

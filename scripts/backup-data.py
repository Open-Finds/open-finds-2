#!/usr/bin/env python3
"""
Copies every table in the live database (and the list of user accounts) into a
dated folder of JSON files, for a restore if something goes wrong — e.g.
before someone runs a security test against the app.

The tables' structure is in supabase/migrations; this saves what's in them.
Uses the service-role key from .env.client.local, so it reads past row-level
security. The output holds personal data and keys: keep it private, never
commit it.

    python3 scripts/backup-data.py [output-folder]
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env(name):
    path = os.path.join(ROOT, name)
    if not os.path.exists(path):
        return {}
    return dict(l.strip().split('=', 1) for l in open(path) if '=' in l and not l.lstrip().startswith('#'))


env = {**load_env('.env'), **load_env('.env.client.local')}
URL = env['VITE_SUPABASE_URL'].strip().strip('"')
KEY = env['SUPABASE_SERVICE_ROLE_KEY'].strip().strip('"')
HEADERS = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}


def get(path, extra=None):
    req = urllib.request.Request(URL + path, headers={**HEADERS, **(extra or {})})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read() or 'null')
        except urllib.error.HTTPError:
            raise
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3)


def main():
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), 'backups', f'unsaved-data-{stamp}')
    os.makedirs(out, mode=0o700, exist_ok=True)

    # Every table PostgREST serves (views are skipped: they're rebuilt by migrations).
    spec = get('/rest/v1/', {'Accept': 'application/openapi+json'})
    names = sorted(spec.get('definitions', {}).keys())
    counts = {}
    for name in names:
        rows, page = [], 1000
        try:
            while True:
                chunk = get(f'/rest/v1/{name}?select=*', {'Range-Unit': 'items', 'Range': f'{len(rows)}-{len(rows) + page - 1}'})
                rows += chunk
                if len(chunk) < page:
                    break
        except urllib.error.HTTPError as e:
            counts[name] = f'skipped (HTTP {e.code})'
            continue
        with open(os.path.join(out, f'{name}.json'), 'w') as f:
            json.dump(rows, f, ensure_ascii=False, indent=1, default=str)
        counts[name] = len(rows)

    # Sign-in accounts live in auth.users, outside the public tables.
    users, n = [], 1
    while True:
        batch = get(f'/auth/v1/admin/users?per_page=200&page={n}').get('users', [])
        users += batch
        if len(batch) < 200:
            break
        n += 1
    with open(os.path.join(out, 'auth_users.json'), 'w') as f:
        json.dump(users, f, ensure_ascii=False, indent=1)
    counts['auth.users'] = len(users)

    manifest = {'project': URL, 'taken_at_utc': stamp, 'counts': counts}
    with open(os.path.join(out, '_manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    for root, _, files in os.walk(out):
        for fn in files:
            os.chmod(os.path.join(root, fn), 0o600)
    print(out)
    for k, v in counts.items():
        print(f'  {k:<32} {v}')


if __name__ == '__main__':
    main()

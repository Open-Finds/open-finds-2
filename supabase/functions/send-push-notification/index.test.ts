import { beforeEach, describe, expect, it, vi } from 'vitest';
import { database } from '../_tests/database';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), limit: vi.fn(), push: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth, serviceClient: mocks.db }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));
vi.mock('../_shared/webpush.ts', () => ({ sendPush: mocks.push }));
const caller = '11111111-1111-4111-8111-111111111111';
const friend = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const plan = '44444444-4444-4444-8444-444444444444';
let db: ReturnType<typeof database>;
let handler: (req: Request) => Promise<Response>;
const request = (body: Record<string, unknown>) => handler(new Request('http://localhost/push', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  db = database();
  mocks.db.mockImplementation(() => db);
  mocks.auth.mockResolvedValue({ ok: true, user: { id: caller } });
  mocks.limit.mockResolvedValue({ allowed: true, available: true });
  mocks.push.mockResolvedValue({ sent: 1, failed: 0, total: 1 });
  vi.stubGlobal('Deno', { env: { get: () => '' }, serve: vi.fn() });
  handler = (await import('./index')).handleRequest;
});

describe('notification event authorization', () => {
  it('rejects unsigned callers before looking up recipients', async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });
    expect((await request({ user_id: stranger, type: 'friend_request' })).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(['general', 'friend_request', 'friend_accepted', 'plan_invite'])('rejects forged %s events', async (type) => {
    expect((await request({ user_id: stranger, type, data: { plan_id: plan } })).status).toBe(403);
    expect(db.inserted).toEqual([]);
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('derives friend-request content and sender from a real pending row', async () => {
    db = database({ friendships: [{ id: 'friendship', requester_id: caller, addressee_id: friend, status: 'pending' }] });
    expect((await request({ user_id: friend, type: 'friend_request', title: 'forged',
      data: { from_user_id: stranger, url: 'https://evil.example/' } })).status).toBe(200);
    expect(db.inserted).toEqual([{ user_id: friend, type: 'friend_request', title: 'New friend request',
      body: 'Someone wants to be your friend', data: { from_user_id: caller } }]);
  });
  it('requires the accepted friendship in the correct direction', async () => {
    db = database({ friendships: [{ id: 'friendship', requester_id: friend, addressee_id: caller, status: 'accepted' }] });
    expect((await request({ user_id: friend, type: 'friend_accepted' })).status).toBe(200);
    expect(db.inserted[0].title).toBe('Friend request accepted');
  });
  it('rejects a mixed authorized/unauthorized recipient batch atomically', async () => {
    db = database({ friendships: [{ id: 'friendship', requester_id: caller, addressee_id: friend, status: 'pending' }] });
    expect((await request({ user_ids: [friend, stranger], type: 'friend_request' })).status).toBe(403);
    expect(db.inserted).toEqual([]);
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('preserves direct event invitations and ignores a forged destination', async () => {
    db = database({ plans: [{ id: plan, owner_id: caller }],
      plan_invites: [{ id: 'invite', plan_id: plan, invited_by: caller, invited_user_id: friend }] });
    expect((await request({ user_id: friend, type: 'plan_invite', data: { plan_id: plan, url: 'https://evil.example' } })).status).toBe(200);
    expect(db.inserted[0].data).toEqual({ plan_id: plan, from_user_id: caller, url: '/#/plan/' + plan });
  });
  it('requires ownership even if an invitation row exists', async () => {
    db = database({ plans: [{ id: plan, owner_id: stranger }],
      plan_invites: [{ id: 'invite', plan_id: plan, invited_by: caller, invited_user_id: friend }] });
    expect((await request({ user_id: friend, type: 'plan_invite', data: { plan_id: plan } })).status).toBe(403);
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('derives group recipients from persisted memberships', async () => {
    db = database({ plans: [{ id: plan, owner_id: caller }],
      plan_invites: [{ id: 'invite', plan_id: plan, invited_by: caller, group_id: 'group' }],
      friend_group_members: [{ group_id: 'group', user_id: friend }] });
    expect((await request({ user_ids: [friend], type: 'plan_invite', data: { plan_id: plan } })).status).toBe(200);
    expect(db.inserted[0].body).toBe('Your group has been invited to an event');
  });
  it('rejects oversized and malformed recipient batches', async () => {
    for (const user_ids of [[friend, 'invalid'], Array(101).fill(friend)]) {
      expect((await request({ user_ids, type: 'friend_request' })).status).toBe(403);
    }
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('uses the stored guest RSVP status and plan owner', async () => {
    db = database({ plans: [{ id: plan, owner_id: friend }],
      rsvps: [{ id: 'rsvp', plan_id: plan, name: 'Guest', status: 'in' }] });
    expect((await request({ plan_id: plan, rsvp_name: 'Guest', rsvp_status: 'declined', user_id: stranger, title: 'forged' })).status).toBe(200);
    expect(db.inserted[0]).toMatchObject({ user_id: friend, title: 'Guest is coming!' });
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it('rejects guest notifications with no persisted RSVP', async () => {
    db = database({ plans: [{ id: plan, owner_id: friend }] });
    expect((await request({ plan_id: plan, rsvp_name: 'Guest' })).status).toBe(403);
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('suppresses repeated/concurrent delivery of the same event', async () => {
    db = database({ plans: [{ id: plan, owner_id: friend }],
      rsvps: [{ id: 'rsvp', plan_id: plan, name: 'Guest', status: 'in' }] });
    let claimed = false;
    mocks.limit.mockImplementation(async (bucket) => {
      if (bucket !== 'push-event') return { allowed: true, available: true };
      const allowed = !claimed; claimed = true; return { allowed, available: true };
    });
    const responses = await Promise.all([request({ plan_id: plan, rsvp_name: 'Guest' }), request({ plan_id: plan, rsvp_name: 'Guest' })]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(db.inserted).toHaveLength(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it('does not deliver when replay storage fails', async () => {
    db = database({ plans: [{ id: plan, owner_id: friend }],
      rsvps: [{ id: 'rsvp', plan_id: plan, name: 'Guest', status: 'in' }] });
    mocks.limit.mockResolvedValueOnce({ allowed: true, available: true })
      .mockResolvedValueOnce({ allowed: false, available: false });
    expect((await request({ plan_id: plan, rsvp_name: 'Guest' })).status).toBe(503);
    expect(db.inserted).toEqual([]);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

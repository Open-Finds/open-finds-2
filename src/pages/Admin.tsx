import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ShieldCheck, Plus, Search, Loader2, Pencil, Trash2, Check, Pause, Play, X,
  Building2, Mail, Phone, MapPin, Users, Lock, UserRound, Clock, Wallet, Store,
} from 'lucide-react';
import {
  fetchAdminPartners, adminUpdatePartner, adminDeletePartner,
  fetchTeam, setTeamRole, setCommission, fetchPayouts, recordPayout, deletePayout,
  partnerStatus, isManagerRole, ROLE_LABELS,
  type AdminPartner, type AppRole, type Payout, type TeamMember, type PartnerStatus,
} from '../lib/supabase';
import { navigate } from '../lib/router';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { AppSelect } from '../components/ui/select';
import { PartnerForm } from '../components/PartnerForm';
import { Badge, Figure, RatingLine, Stat, StatusBadge } from '../components/PartnerBits';
import { TYPE_LABELS, money } from '../lib/partners';
import { cn } from '../lib/utils';

type Tab = 'overview' | 'approvals' | 'venues' | 'team';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'venues', label: 'Venues' },
  { key: 'team', label: 'Team' },
];
const goTab = (t: Tab) => navigate(t === 'overview' ? '/admin' : `/admin/${t}`);

type Filter = 'all' | PartnerStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'pending', label: 'Pending' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'paused', label: 'Paused' },
];

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Worker · submits venues' },
  { value: 'manager', label: 'Manager · runs venues' },
  { value: 'admin', label: 'Super admin · everything' },
];

/**
 * The admin dashboard, for managers and the super admin (Robert): every venue
 * partner, the approval queue, and the team's venues, revenue and commission.
 * Workers have My Venues instead. The server checks the role on every call.
 */
export function AdminPage({ tab: tabParam, onBack }: { tab?: string; onBack: () => void }) {
  const { role, profileLoaded } = useAuth();
  const isAdmin = role === 'admin';
  const canManage = isManagerRole(role);
  const tab: Tab = TABS.some((t) => t.key === tabParam) ? (tabParam as Tab) : 'overview';

  const [partners, setPartners] = useState<AdminPartner[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminPartner | 'new' | null>(null);
  const [rejecting, setRejecting] = useState<AdminPartner | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, members, paid] = await Promise.all([
        fetchAdminPartners(),
        fetchTeam(),
        // Not there until the workers migration is applied; nothing paid yet.
        fetchPayouts().catch(() => [] as Payout[]),
      ]);
      setPartners(list);
      setTeam(members);
      setPayouts(paid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  const act = async (id: string, change: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await change();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  const approve = (p: AdminPartner) => act(p.id, () => adminUpdatePartner(p.id, { approved: true, active: true, rejection_reason: null }));

  if (!profileLoaded) {
    return <div className="min-h-screen bg-black" />;
  }

  const pending = partners.filter((p) => partnerStatus(p) === 'pending');

  return (
    <div className="min-h-screen bg-black px-4 pt-20 pb-28 sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back to the app"
            className="-ml-1 flex items-center justify-center rounded-full text-gold transition-all active:scale-90"
          >
            <ChevronLeft size={28} strokeWidth={2.5} />
          </button>
          <ShieldCheck size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-white">Admin</h1>
          {canManage && <Badge tone="gold">{ROLE_LABELS[role]}</Badge>}
        </div>

        {!canManage ? (
          <div className="mt-8 rounded-card border border-gold/20 bg-[#111] p-8 text-center">
            <Lock size={28} className="mx-auto mb-3 text-gold/60" />
            <p className="font-semibold text-white">The admin dashboard is for managers.</p>
            {role === 'staff' ? (
              <>
                <p className="mt-1 text-sm text-ink-secondary">Your venues and commission are in My Venues.</p>
                <Button className="mt-5" onClick={() => navigate('/my-venues')}><Store /> Open My Venues</Button>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-secondary">Ask the super admin if you need access.</p>
            )}
          </div>
        ) : (
          <>
            {/* Sections. Sticky so they're always one tap away. */}
            <nav aria-label="Admin sections" className="sticky top-0 z-30 -mx-4 mb-6 overflow-x-auto bg-black/95 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
              <div className="flex gap-2">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => goTab(t.key)}
                    aria-current={tab === t.key ? 'page' : undefined}
                    className={cn(
                      'whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-all',
                      tab === t.key ? 'border-gold bg-gold text-black' : 'border-gold/30 text-gold hover:bg-gold/10'
                    )}
                  >
                    {t.label}
                    {t.key === 'approvals' && pending.length > 0 && (
                      <span className={cn('ml-1.5 rounded-full px-1.5 text-xs', tab === t.key ? 'bg-black/20' : 'bg-gold text-black')}>{pending.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </nav>

            {tab !== 'overview' && (
              <button onClick={() => goTab('overview')} className="mb-4 flex items-center gap-1 text-sm font-semibold text-gold hover:underline">
                <ChevronLeft size={16} /> Admin overview
              </button>
            )}

            {error && (
              <p role="alert" className="mb-4 rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>
            )}

            {loading && partners.length === 0 && team.length === 0 ? (
              <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gold" /></div>
            ) : tab === 'overview' ? (
              <Overview partners={partners} team={team} />
            ) : tab === 'approvals' ? (
              <Approvals partners={partners} busyId={busyId} onApprove={approve} onReject={setRejecting} onEdit={setEditing} />
            ) : tab === 'venues' ? (
              <Venues
                partners={partners}
                isAdmin={isAdmin}
                busyId={busyId}
                onAdd={() => setEditing('new')}
                onEdit={setEditing}
                onApprove={approve}
                onReject={setRejecting}
                onTogglePause={(p) => act(p.id, () => adminUpdatePartner(p.id, { active: !p.active }))}
                onDelete={(p) => act(p.id, () => adminDeletePartner(p.id))}
              />
            ) : (
              <TeamTab team={team} payouts={payouts} isAdmin={isAdmin} onChanged={load} />
            )}

            {editing && (
              <PartnerForm
                partner={editing === 'new' ? null : editing}
                canManage
                team={team}
                onClose={() => setEditing(null)}
                onSaved={async () => { setEditing(null); await load(); }}
              />
            )}
            {rejecting && (
              <RejectDialog
                partner={rejecting}
                onClose={() => setRejecting(null)}
                onReject={async (reason) => {
                  const p = rejecting;
                  setRejecting(null);
                  await act(p.id, () => adminUpdatePartner(p.id, { approved: false, rejection_reason: reason }));
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────── */

function Overview({ partners, team }: { partners: AdminPartner[]; team: TeamMember[] }) {
  const counts = useMemo(() => {
    const c = { live: 0, pending: 0, rejected: 0, paused: 0 };
    for (const p of partners) c[partnerStatus(p)]++;
    return c;
  }, [partners]);
  const monthBilled = partners.reduce((n, p) => n + p.month_billed_cents, 0);
  const totalBilled = partners.reduce((n, p) => n + p.total_billed_cents, 0);
  const monthVisits = partners.reduce((n, p) => n + p.month_visits, 0);
  const unpaid = team.reduce((n, m) => n + m.sales.unpaid_cents, 0);
  const paid = team.reduce((n, m) => n + m.sales.paid_cents, 0);
  const sellers = team.filter((m) => m.sales.clients > 0 || m.role === 'staff');

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Venues submitted" value={String(partners.length)} hint={`${counts.live} live · ${counts.paused} paused`} />
        <Stat label="Revenue this month" value={money(monthBilled)} hint={`${money(totalBilled)} all time`} />
        <Stat label="Commission owed" value={money(unpaid)} hint={`${money(paid)} paid so far`} />
        <Stat label="Visits this month" value={String(monthVisits)} hint="Each review counts as a visit" />
      </div>

      <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
        <h2 className="mb-3 text-sm font-bold text-white">Pending, approved and rejected</h2>
        <div className="grid grid-cols-3 gap-2 text-center">
          <BreakdownButton label="Pending" value={counts.pending} tone="text-pending" onClick={() => goTab('approvals')} />
          <BreakdownButton label="Approved" value={counts.live + counts.paused} tone="text-success" onClick={() => goTab('venues')} />
          <BreakdownButton label="Rejected" value={counts.rejected} tone="text-danger" onClick={() => goTab('venues')} />
        </div>
        {partners.length > 0 && (
          <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/5" aria-hidden>
            <span className="bg-pending" style={{ width: `${(counts.pending / partners.length) * 100}%` }} />
            <span className="bg-success" style={{ width: `${((counts.live + counts.paused) / partners.length) * 100}%` }} />
            <span className="bg-danger" style={{ width: `${(counts.rejected / partners.length) * 100}%` }} />
          </div>
        )}
      </section>

      <section className="rounded-card border border-gold/20 bg-[#111] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white">By team member</h2>
          <button onClick={() => goTab('team')} className="text-xs font-semibold text-gold hover:underline">Team & payouts →</button>
        </div>
        {sellers.length === 0 ? (
          <p className="text-sm text-ink-secondary">No workers yet. Add one in Team.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs text-ink-secondary">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 text-right font-semibold">Submitted</th>
                  <th className="py-2 pr-3 text-right font-semibold">Live</th>
                  <th className="py-2 pr-3 text-right font-semibold">Revenue</th>
                  <th className="py-2 pr-3 text-right font-semibold">Commission</th>
                  <th className="py-2 text-right font-semibold">Unpaid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gold/10">
                {sellers.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-white">{m.display_name ?? m.email}</span>
                      <span className="ml-1.5 text-xs text-ink-secondary">{ROLE_LABELS[m.role]}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-white">{m.sales.clients}</td>
                    <td className="py-2.5 pr-3 text-right text-white">{m.sales.live}</td>
                    <td className="py-2.5 pr-3 text-right text-white">{money(m.sales.total_billed_cents)}</td>
                    <td className="py-2.5 pr-3 text-right text-white">{money(m.sales.total_commission_cents)} <span className="text-xs text-ink-secondary">({m.sales.commission_percent}%)</span></td>
                    <td className="py-2.5 text-right font-semibold text-gold">{money(m.sales.unpaid_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function BreakdownButton({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-card border border-gold/10 bg-black/40 p-3 transition-colors hover:border-gold/40">
      <p className={cn('text-2xl font-bold', tone)}>{value}</p>
      <p className="text-xs text-ink-secondary">{label}</p>
    </button>
  );
}

/* ── Approvals ────────────────────────────────────────────── */

function Approvals({
  partners, busyId, onApprove, onReject, onEdit,
}: {
  partners: AdminPartner[];
  busyId: string | null;
  onApprove: (p: AdminPartner) => void;
  onReject: (p: AdminPartner) => void;
  onEdit: (p: AdminPartner) => void;
}) {
  const pending = partners.filter((p) => partnerStatus(p) === 'pending');
  const rejected = partners.filter((p) => partnerStatus(p) === 'rejected');
  return (
    <>
      <p className="mb-4 text-sm text-ink-secondary">
        Workers' venues go live straight away. Venues that sign themselves up wait here. Reject anything that shouldn't be in the app, with a reason the worker sees.
      </p>
      {pending.length === 0 ? (
        <Empty icon={Clock} text="Nothing waiting for approval." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pending.map((p) => (
            <PartnerCard key={p.id} p={p}>
              <Button size="sm" disabled={busyId === p.id} onClick={() => onApprove(p)}><Check /> Approve</Button>
              <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onReject(p)}><X /> Reject</Button>
              <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => onEdit(p)}><Pencil /> Edit</Button>
            </PartnerCard>
          ))}
        </div>
      )}
      {rejected.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-bold text-white">Rejected ({rejected.length})</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rejected.map((p) => (
              <PartnerCard key={p.id} p={p}>
                <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onApprove(p)}><Check /> Approve after all</Button>
              </PartnerCard>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ── Venues ───────────────────────────────────────────────── */

function Venues({
  partners, isAdmin, busyId, onAdd, onEdit, onApprove, onReject, onTogglePause, onDelete,
}: {
  partners: AdminPartner[];
  isAdmin: boolean;
  busyId: string | null;
  onAdd: () => void;
  onEdit: (p: AdminPartner) => void;
  onApprove: (p: AdminPartner) => void;
  onReject: (p: AdminPartner) => void;
  onTogglePause: (p: AdminPartner) => void;
  onDelete: (p: AdminPartner) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter((p) => {
      if (filter !== 'all' && partnerStatus(p) !== filter) return false;
      if (!q) return true;
      return [p.business_name, p.contact_name, p.contact_email, p.contact_phone ?? '', p.address, p.account_manager_name ?? '']
        .some((f) => f.toLowerCase().includes(q));
    });
  }, [partners, search, filter]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/50" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search venues, contacts, emails, workers…"
            className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-12 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
          />
        </div>
        <Button onClick={onAdd} className="shadow-gold-glow">
          <Plus /> Add venue partner
        </Button>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all',
              filter === f.key ? 'border-gold bg-gold text-black' : 'border-gold/30 text-gold hover:bg-gold/10'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty icon={Building2} text={partners.length === 0 ? 'No venue partners yet. Add the first one.' : 'Nothing matches.'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((p) => {
            const status = partnerStatus(p);
            return (
              <PartnerCard key={p.id} p={p}>
                {status !== 'live' && status !== 'paused' && (
                  <Button size="sm" disabled={busyId === p.id} onClick={() => onApprove(p)}><Check /> Approve</Button>
                )}
                <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onEdit(p)}><Pencil /> Edit</Button>
                {(status === 'live' || status === 'paused') && (
                  <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => onTogglePause(p)}>
                    {p.active ? <><Pause /> Pause</> : <><Play /> Resume</>}
                  </Button>
                )}
                {status !== 'rejected' && (
                  <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => onReject(p)}><X /> Reject</Button>
                )}
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === p.id}
                    onClick={() => (armedDelete === p.id ? onDelete(p) : setArmedDelete(p.id))}
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 /> {armedDelete === p.id ? 'Tap again to delete' : 'Delete'}
                  </Button>
                )}
              </PartnerCard>
            );
          })}
        </div>
      )}
    </>
  );
}

function PartnerCard({ p, children }: { p: AdminPartner; children: React.ReactNode }) {
  return (
    <article className="min-w-0 rounded-card border border-gold/20 bg-[#111] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-white">{p.business_name}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-secondary"><MapPin size={13} className="shrink-0 text-gold/70" /> <span className="truncate">{p.address}</span></p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge tone="gold">{TYPE_LABELS[p.type] ?? p.type}</Badge>
          <StatusBadge status={partnerStatus(p)} />
        </div>
      </div>

      {p.rejection_reason && !p.approved && (
        <p className="mt-3 rounded-card border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-red-200">Rejected: {p.rejection_reason}</p>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary">
        <span className="text-white">{p.contact_name}</span>
        <a href={`mailto:${p.contact_email}`} className="flex min-w-0 items-center gap-1 text-gold hover:underline"><Mail size={13} /> <span className="truncate">{p.contact_email}</span></a>
        {p.contact_phone && <a href={`tel:${p.contact_phone}`} className="flex items-center gap-1 text-gold hover:underline"><Phone size={13} /> {p.contact_phone}</a>}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-secondary">
        <UserRound size={12} className="text-gold/70" />
        {p.account_manager_name ? <>Submitted by <span className="text-white">{p.account_manager_name}</span></> : 'Signed itself up · no worker yet'}
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-1 rounded-card border border-gold/10 bg-black/40 p-2 text-center sm:gap-2 sm:p-3">
        <Figure label="Visits this month" value={String(p.month_visits)} />
        <Figure label="Billed this month" value={money(p.month_billed_cents)} hint={p.monthly_budget_cents != null ? `of ${money(p.monthly_budget_cents)}` : 'no budget'} />
        <Figure label="Billed all time" value={money(p.total_billed_cents)} />
      </dl>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-ink-secondary">
        <span>{money(p.visit_rate_cents)} a review / visit · {p.impressions} appearances · {p.visits} visits</span>
        <RatingLine average={p.average_rating} count={p.review_count} />
      </p>

      <div className="mt-4 flex flex-wrap gap-2">{children}</div>
    </article>
  );
}

function RejectDialog({ partner, onClose, onReject }: { partner: AdminPartner; onClose: () => void; onReject: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Reject {partner.business_name}?</DialogTitle>
          <DialogDescription>It comes out of the app. {partner.account_manager_name ? `${partner.account_manager_name} sees` : 'The worker sees'} your reason in My Venues.</DialogDescription>
        </DialogHeader>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={300}
          placeholder="e.g. Closed down, or a duplicate of another venue"
          aria-label="Reason"
          className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="sm:w-auto">Cancel</Button>
          <Button disabled={!reason.trim()} onClick={() => void onReject(reason.trim())} className="sm:w-auto"><X /> Reject</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <div className="rounded-card border border-gold/20 bg-[#111] p-8 text-center">
      <Icon size={28} className="mx-auto mb-3 text-gold/50" />
      <p className="text-sm text-ink-secondary">{text}</p>
    </div>
  );
}

/* ── Team ─────────────────────────────────────────────────── */

/** A team member's commission %, saved when the box loses focus or on Enter. */
function CommissionInput({ member, onSaved }: { member: TeamMember; onSaved: (text: string, ok: boolean) => void }) {
  const [value, setValue] = useState(String(member.sales.commission_percent));
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(String(member.sales.commission_percent)), [member.sales.commission_percent]);
  const save = async () => {
    const pct = Number(value.replace('%', '').trim());
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      onSaved('Commission is a percentage from 0 to 100.', false);
      setValue(String(member.sales.commission_percent));
      return;
    }
    if (pct === member.sales.commission_percent) return;
    setSaving(true);
    try {
      await setCommission(member.id, pct);
      onSaved(`${member.display_name ?? member.email} now earns ${pct}% commission.`, true);
    } catch (e) {
      onSaved(e instanceof Error ? e.message : "Couldn't save the commission.", false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
      Commission
      <span className="relative">
        <input
          inputMode="decimal"
          value={value}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          aria-label={`Commission for ${member.email}`}
          className="w-16 rounded-card border border-gold/20 bg-black/40 py-1.5 pl-2 pr-5 text-right text-sm text-white outline-none focus:border-gold"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-ink-secondary">%</span>
      </span>
    </label>
  );
}

/**
 * Who's on the team and what they're owed. The super admin gives roles by
 * email, sets commission and marks it paid; managers see the same numbers.
 */
function TeamTab({ team, payouts, isAdmin, onChanged }: { team: TeamMember[]; payouts: Payout[]; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('staff');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [view, setView] = useState<'unpaid' | 'paid'>('unpaid');
  const [paying, setPaying] = useState<TeamMember | null>(null);
  const names = new Map(team.map((m) => [m.id, m.display_name ?? m.email]));

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ ok: true, text: done });
      await onChanged();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };
  const changeRole = (target: string, role: AppRole, done: string) => run(() => setTeamRole(target, role), done);

  const owed = team.filter((m) => m.sales.unpaid_cents > 0);

  return (
    <>
      {/* Commission paid and unpaid */}
      <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Wallet size={18} className="text-gold" /> Commission</h2>
          <div role="tablist" aria-label="Commission" className="flex rounded-full border border-gold/30 p-0.5">
            {(['unpaid', 'paid'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn('rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition-all', view === v ? 'bg-gold text-black' : 'text-gold')}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-sm text-ink-secondary">
          Each worker earns their commission % of what their venues are billed, for as long as the venue pays.
        </p>
        {view === 'unpaid' ? (
          owed.length === 0 ? (
            <p className="mt-4 text-sm text-ink-secondary">Nobody is owed anything right now.</p>
          ) : (
            <ul className="mt-4 divide-y divide-gold/10">
              {owed.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{m.display_name ?? m.email}</p>
                    <p className="text-xs text-ink-secondary">{money(m.sales.total_commission_cents)} earned · {money(m.sales.paid_cents)} paid</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-bold text-gold">{money(m.sales.unpaid_cents)}</span>
                    {isAdmin && <Button size="sm" disabled={busy} onClick={() => setPaying(m)}><Check /> Mark paid</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : payouts.length === 0 ? (
          <p className="mt-4 text-sm text-ink-secondary">No payments recorded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gold/10">
            {payouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{names.get(p.user_id) ?? 'Former team member'}</p>
                  <p className="text-xs text-ink-secondary">
                    {new Date(p.paid_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-bold text-success">{money(p.amount_cents)}</span>
                  {isAdmin && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => deletePayout(p.id), 'Payment removed.')} aria-label={`Undo payment to ${names.get(p.user_id) ?? 'them'}`}>
                      Undo
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* People and roles */}
      <section className="rounded-card border border-gold/20 bg-[#111] p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Users size={18} className="text-gold" /> Team</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Workers submit venues and see their own in My Venues. Managers run this dashboard. Only the super admin changes roles, commission and payments.
        </p>

        {isAdmin && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const target = email.trim();
              if (target) void changeRole(target, newRole, `${target} is now a ${ROLE_LABELS[newRole].toLowerCase()}.`).then(() => setEmail(''));
            }}
            className="mt-4 flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Their sign-in email"
              aria-label="Their sign-in email"
              className="min-w-0 flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold"
            />
            <AppSelect value={newRole} onChange={(v) => setNewRole(v as AppRole)} options={ROLE_OPTIONS} ariaLabel="Role" className="sm:w-60" />
            <Button type="submit" disabled={busy || !email.trim()}>
              <Plus /> Add
            </Button>
          </form>
        )}
        {message && (
          <p role="status" className={cn('mt-2 text-sm', message.ok ? 'text-success' : 'text-red-300')}>{message.text}</p>
        )}

        <ul className="mt-4 divide-y divide-gold/10">
          {team.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 py-3 lg:flex-row lg:items-center lg:gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">
                  {m.display_name ?? m.email}{m.id === session?.user.id && <span className="text-ink-secondary"> (you)</span>}
                  <span className="ml-2 align-middle"><Badge tone="muted">{ROLE_LABELS[m.role]}</Badge></span>
                </p>
                <p className="truncate text-xs text-ink-secondary">{m.email}</p>
                <p className="mt-1 text-xs text-ink-secondary">
                  {m.sales.clients} submitted · {m.sales.live} live · {money(m.sales.total_billed_cents)} revenue ·{' '}
                  <span className="text-white">{money(m.sales.total_commission_cents)} earned</span> ·{' '}
                  <span className="text-gold">{money(m.sales.unpaid_cents)} unpaid</span>
                </p>
              </div>
              {isAdmin ? (
                <div className="flex flex-wrap items-center gap-2">
                  <CommissionInput member={m} onSaved={(text, ok) => { setMessage({ ok, text }); if (ok) void onChanged(); }} />
                  <AppSelect
                    value={m.role}
                    onChange={(v) => void changeRole(m.email, v as AppRole, `${m.display_name ?? m.email} is now a ${ROLE_LABELS[v as AppRole].toLowerCase()}.`)}
                    options={ROLE_OPTIONS}
                    ariaLabel={`Role for ${m.email}`}
                    className="min-w-0 flex-1 sm:w-60 sm:flex-none"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void changeRole(m.email, 'user', `${m.display_name ?? m.email} no longer has access.`)}
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                  >
                    Remove
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-ink-secondary">{m.sales.commission_percent}% commission</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {paying && (
        <PayDialog
          member={paying}
          onClose={() => setPaying(null)}
          onPay={async (cents, note) => {
            const m = paying;
            setPaying(null);
            await run(() => recordPayout(m.id, cents, note), `Recorded ${money(cents)} paid to ${m.display_name ?? m.email}.`);
          }}
        />
      )}
    </>
  );
}

function PayDialog({ member, onClose, onPay }: { member: TeamMember; onClose: () => void; onPay: (cents: number, note: string) => Promise<void> }) {
  const [amount, setAmount] = useState((member.sales.unpaid_cents / 100).toFixed(2));
  const [note, setNote] = useState('');
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, '')) * 100);
  const valid = Number.isFinite(cents) && cents > 0;
  const field = 'w-full rounded-card border border-gold/20 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold';
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">Mark commission paid</DialogTitle>
          <DialogDescription>Record what you've paid {member.display_name ?? member.email}. They're owed {money(member.sales.unpaid_cents)}.</DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-secondary">Amount paid ($)</span>
          <input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-secondary">Note (optional)</span>
          <input className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bank transfer 10 Oct" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="sm:w-auto">Cancel</Button>
          <Button disabled={!valid} onClick={() => void onPay(cents, note)} className="sm:w-auto"><Check /> Mark paid</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

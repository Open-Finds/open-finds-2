import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ChevronLeft, ShieldCheck, Plus, Search, Loader2, Pencil, Trash2, Check, Pause, Play,
  Building2, Mail, MapPin, Users, Lock,
} from 'lucide-react';
import {
  fetchAdminPartners, adminCreatePartner, adminUpdatePartner, adminDeletePartner,
  fetchTeam, setTeamRole,
  type AdminPartner, type AdminPartnerInput, type AppRole, type TeamMember, type VenueType,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { AppSelect, VenueTypeSelect } from '../components/ui/select';
import { cn } from '../lib/utils';

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

const TYPE_LABELS: Record<string, string> = { food: 'Food', bar: 'Bar', dessert: 'Dessert', activity: 'Activity' };

type Filter = 'all' | 'pending' | 'live' | 'paused';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'live', label: 'Live' },
  { key: 'paused', label: 'Paused' },
];

const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff · venue partners' },
  { value: 'admin', label: 'Admin · everything' },
];

/**
 * Robert's back office (Round 3, item 23, and the admin levels from the call):
 * staff see and manage venue partners and what they've been billed; admins
 * also approve them, set their rate, delete them, and choose the team.
 */
export function AdminPage({ onBack }: { onBack: () => void }) {
  const { role, profileLoaded } = useAuth();
  const isAdmin = role === 'admin';

  const [partners, setPartners] = useState<AdminPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<AdminPartner | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPartners(await fetchAdminPartners());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load venue partners.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role !== 'user') void load();
  }, [role, load]);

  const totals = useMemo(() => ({
    count: partners.length,
    pending: partners.filter((p) => !p.approved).length,
    monthVisits: partners.reduce((n, p) => n + p.month_visits, 0),
    monthBilled: partners.reduce((n, p) => n + p.month_billed_cents, 0),
    totalBilled: partners.reduce((n, p) => n + p.total_billed_cents, 0),
  }), [partners]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return partners.filter((p) => {
      if (filter === 'pending' && p.approved) return false;
      if (filter === 'live' && !(p.approved && p.active)) return false;
      if (filter === 'paused' && p.active) return false;
      if (!q) return true;
      return [p.business_name, p.contact_name, p.contact_email, p.address].some((f) => f.toLowerCase().includes(q));
    });
  }, [partners, search, filter]);

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
      setArmedDelete(null);
    }
  };

  if (!profileLoaded) {
    return <div className="min-h-screen bg-black" />;
  }

  return (
    <div className="min-h-screen overflow-y-auto bg-black px-6 pt-20 pb-24">
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-5 top-5 flex items-center justify-center rounded-full text-gold transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-2 flex items-center gap-3">
          <ShieldCheck size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-white">Admin</h1>
          {role !== 'user' && (
            <span className="rounded-full border border-gold/40 bg-gold/10 px-2.5 py-0.5 text-xs font-semibold capitalize text-gold">{role}</span>
          )}
        </div>

        {role === 'user' ? (
          <div className="mt-8 rounded-card border border-gold/20 bg-[#111] p-8 text-center">
            <Lock size={28} className="mx-auto mb-3 text-gold/60" />
            <p className="font-semibold text-white">This page is for The Unsaved team.</p>
            <p className="mt-1 text-sm text-ink-secondary">Ask an admin to add you if you need access.</p>
          </div>
        ) : (
          <>
            <p className="mb-8 text-sm text-ink-secondary">
              Venue partners, how they're doing, and what they've been billed.
            </p>

            {/* Summary */}
            <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Venue partners" value={String(totals.count)} hint={totals.pending ? `${totals.pending} waiting for approval` : 'None waiting'} />
              <Stat label="Visits this month" value={String(totals.monthVisits)} />
              <Stat label="Billed this month" value={money(totals.monthBilled)} />
              <Stat label="Billed all time" value={money(totals.totalBilled)} />
            </div>

            {/* Toolbar */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/50" size={18} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search venues, contacts, emails…"
                  className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-12 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                />
              </div>
              <Button onClick={() => setEditing('new')} className="shadow-gold-glow">
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

            {error && (
              <p role="alert" className="mb-4 rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>
            )}

            {/* Partners */}
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-gold" /></div>
            ) : shown.length === 0 ? (
              <div className="rounded-card border border-gold/20 bg-[#111] p-8 text-center">
                <Building2 size={28} className="mx-auto mb-3 text-gold/50" />
                <p className="text-sm text-ink-secondary">
                  {partners.length === 0 ? 'No venue partners yet. Add the first one.' : 'Nothing matches.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {shown.map((p) => (
                  <article key={p.id} className="min-w-0 rounded-card border border-gold/20 bg-[#111] p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-lg font-bold text-white">{p.business_name}</h3>
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-secondary"><MapPin size={13} className="shrink-0 text-gold/70" /> <span className="truncate">{p.address}</span></p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        <Badge tone="gold">{TYPE_LABELS[p.type] ?? p.type}</Badge>
                        {!p.approved ? <Badge tone="pending">Pending</Badge> : p.active ? <Badge tone="good">Live</Badge> : <Badge tone="muted">Paused</Badge>}
                      </div>
                    </div>

                    <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-secondary">
                      <span className="text-white">{p.contact_name}</span>
                      <a href={`mailto:${p.contact_email}`} className="flex items-center gap-1 text-gold hover:underline"><Mail size={13} /> {p.contact_email}</a>
                      <span>{p.has_account ? 'Has an account' : 'No account yet'}</span>
                    </p>

                    <dl className="mt-4 grid grid-cols-3 gap-1 rounded-card border border-gold/10 bg-black/40 p-2 text-center sm:gap-2 sm:p-3">
                      <Figure label="Visits this month" value={String(p.month_visits)} />
                      <Figure label="Billed this month" value={money(p.month_billed_cents)} hint={p.monthly_budget_cents != null ? `of ${money(p.monthly_budget_cents)}` : 'no budget'} />
                      <Figure label="Billed all time" value={money(p.total_billed_cents)} />
                    </dl>
                    <p className="mt-2 text-xs text-ink-secondary">
                      {money(p.visit_rate_cents)} a visit · {p.impressions} views · {p.saves} saves · {p.visits} visits all time
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {isAdmin && !p.approved && (
                        <Button size="sm" disabled={busyId === p.id} onClick={() => act(p.id, () => adminUpdatePartner(p.id, { approved: true, active: true }))}>
                          <Check /> Approve
                        </Button>
                      )}
                      <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => setEditing(p)}>
                        <Pencil /> Edit
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === p.id} onClick={() => act(p.id, () => adminUpdatePartner(p.id, { active: !p.active }))}>
                        {p.active ? <><Pause /> Pause</> : <><Play /> Resume</>}
                      </Button>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === p.id}
                          onClick={() => (armedDelete === p.id ? act(p.id, () => adminDeletePartner(p.id)) : setArmedDelete(p.id))}
                          className="text-danger hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 /> {armedDelete === p.id ? 'Tap again to delete' : 'Delete'}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {isAdmin && <TeamSection />}

            {editing && (
              <PartnerForm
                partner={editing === 'new' ? null : editing}
                isAdmin={isAdmin}
                onClose={() => setEditing(null)}
                onSaved={async () => { setEditing(null); await load(); }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-gold/20 bg-[#111] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gold/70">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-secondary">{hint}</p>}
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 font-bold text-white">{value}</dd>
      {hint && <dd className="text-[11px] text-ink-secondary">{hint}</dd>}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'gold' | 'good' | 'pending' | 'muted'; children: React.ReactNode }) {
  const tones = {
    gold: 'border-gold/30 bg-gold/10 text-gold',
    good: 'border-success/30 bg-success/10 text-success',
    pending: 'border-pending/40 bg-pending/10 text-pending',
    muted: 'border-ink-secondary/30 bg-white/5 text-ink-secondary',
  };
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

/** Dollars typed by a person, as cents; blank is "none". */
function toCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

function PartnerForm({
  partner,
  isAdmin,
  onClose,
  onSaved,
}: {
  partner: AdminPartner | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [businessName, setBusinessName] = useState(partner?.business_name ?? '');
  const [contactName, setContactName] = useState(partner?.contact_name ?? '');
  const [email, setEmail] = useState(partner?.contact_email ?? '');
  const [address, setAddress] = useState(partner?.address ?? '');
  const [type, setType] = useState<VenueType>((partner?.type as VenueType) ?? 'food');
  const [budget, setBudget] = useState(partner?.monthly_budget_cents != null ? (partner.monthly_budget_cents / 100).toFixed(2) : '');
  const [rate, setRate] = useState(((partner?.visit_rate_cents ?? 10) / 100).toFixed(2));
  const [website, setWebsite] = useState(partner?.website ?? '');
  const [instagram, setInstagram] = useState(partner?.instagram_link ?? '');
  const [approved, setApproved] = useState(partner?.approved ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!businessName.trim() || !contactName.trim() || !email.trim() || !address.trim()) {
      setError('Business name, contact, email and address are all needed.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("That email doesn't look right.");
      return;
    }
    const budgetCents = toCents(budget);
    const rateCents = toCents(rate);
    if (Number.isNaN(budgetCents) || (isAdmin && (rateCents == null || Number.isNaN(rateCents)))) {
      setError('Budget and rate are dollar amounts, like 250 or 0.10.');
      return;
    }
    const input: AdminPartnerInput = {
      business_name: businessName.trim(),
      contact_name: contactName.trim(),
      contact_email: email.trim(),
      address: address.trim(),
      type,
      monthly_budget_cents: budgetCents,
      website: website.trim() || null,
      instagram_link: instagram.trim() || null,
      ...(isAdmin ? { visit_rate_cents: rateCents as number, approved } : {}),
    };
    setSaving(true);
    try {
      if (partner) await adminUpdatePartner(partner.id, input);
      else await adminCreatePartner(input);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
      setSaving(false);
    }
  };

  const field = 'w-full rounded-card border border-gold/20 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold';

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{partner ? `Edit ${partner.business_name}` : 'Add venue partner'}</DialogTitle>
          <DialogDescription>
            {isAdmin ? 'Details, budget and rate.' : 'An admin approves new partners and sets their rate.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Labeled label="Business name"><input className={field} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Pocket Burger" /></Labeled>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Contact name"><input className={field} value={contactName} onChange={(e) => setContactName(e.target.value)} /></Labeled>
            <Labeled label="Contact email"><input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Labeled>
          </div>
          <Labeled label="Address"><input className={field} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, suburb, state, postcode" /></Labeled>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Type"><VenueTypeSelect value={type} onChange={setType} /></Labeled>
            <Labeled label="Monthly budget ($)"><input className={field} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" /></Labeled>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Website (optional)"><input className={field} value={website} onChange={(e) => setWebsite(e.target.value)} /></Labeled>
            <Labeled label="Instagram (optional)"><input className={field} value={instagram} onChange={(e) => setInstagram(e.target.value)} /></Labeled>
          </div>
          {isAdmin && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="Rate per visit ($)"><input className={field} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Labeled>
              <label className="mt-6 flex items-center gap-2 text-sm text-white">
                <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="size-4 accent-[#D4AF35]" />
                Approved
              </label>
            </div>
          )}
          {error && <p role="alert" className="rounded-card border border-red-400/40 bg-red-400/10 px-4 py-2.5 text-sm text-red-200">{error}</p>}
          <div className="mt-2 flex gap-3">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? <Loader2 className="animate-spin" /> : <Check />} {partner ? 'Save changes' : 'Add partner'}
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-secondary">{label}</span>
      {children}
    </label>
  );
}

/** Admins choose who else gets in, and at what level. */
function TeamSection() {
  const { session } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('staff');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTeam(await fetchTeam());
    } catch {
      setMessage({ ok: false, text: "Couldn't load the team." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const change = async (targetEmail: string, role: AppRole, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await setTeamRole(targetEmail, role);
      setMessage({ ok: true, text: done });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'That did not work.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10 rounded-card border border-gold/20 bg-[#111] p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold text-white"><Users size={18} className="text-gold" /> Team</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Staff can see and manage venue partners. Admins can also approve them, set rates, delete them, and change the team.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (email.trim()) void change(email.trim(), newRole, `${email.trim()} is now ${newRole}.`).then(() => setEmail('')); }}
        className="mt-4 flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Their sign-in email"
          className="min-w-0 flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold"
        />
        <AppSelect value={newRole} onChange={(v) => setNewRole(v as AppRole)} options={ROLE_OPTIONS} ariaLabel="Role" className="sm:w-56" />
        <Button type="submit" disabled={busy || !email.trim()}>
          <Plus /> Add
        </Button>
      </form>
      {message && (
        <p role="status" className={cn('mt-2 text-sm', message.ok ? 'text-success' : 'text-red-300')}>{message.text}</p>
      )}

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-gold" /></div>
      ) : (
        <ul className="mt-4 divide-y divide-gold/10">
          {team.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">
                  {m.display_name ?? m.email}{m.id === session?.user.id && <span className="text-ink-secondary"> (you)</span>}
                </p>
                <p className="truncate text-xs text-ink-secondary">{m.email}</p>
              </div>
              <div className="flex items-center gap-2">
              <AppSelect
                value={m.role}
                onChange={(v) => void change(m.email, v as AppRole, `${m.display_name ?? m.email} is now ${v}.`)}
                options={ROLE_OPTIONS}
                ariaLabel={`Role for ${m.email}`}
                className="min-w-0 flex-1 sm:w-56 sm:flex-none"
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void change(m.email, 'user', `${m.display_name ?? m.email} no longer has access.`)}
                className="text-danger hover:bg-danger/10 hover:text-danger"
              >
                Remove
              </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft,
  Building2,
  MapPin,
  Globe,
  Instagram,
  Mail,
  User,
  DollarSign,
  TrendingUp,
  Eye,
  Bookmark,
  Footprints,
  Pause,
  Play,
  Save,
  Check,
  Loader2,
  AlertCircle,
  Star,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  fetchVenuePartner,
  createVenuePartner,
  updateVenuePartner,
  fetchVenueEventStats,
  fetchVenueMilestones,
  type VenuePartner,
  type VenueType,
  type VenueEventStats,
  type VenueMilestone,
} from '../lib/supabase';
import { geocodeAddress } from '../lib/apiKeys';

const MILESTONE_THRESHOLDS = [10, 50, 100, 500];

export function VenuePortalPage({ onBack }: { onBack: () => void }) {
  const { session } = useAuth();
  const [partner, setPartner] = useState<VenuePartner | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignup, setShowSignup] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await fetchVenuePartner();
      setPartner(p);
      if (!p) setShowSignup(true);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Loader2 size={32} className="animate-spin text-gold" />
      </div>
    );
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

      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-gold/30 bg-gold/10">
            <Building2 size={24} className="text-gold" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Venue Partner Portal</h1>
            <p className="text-sm text-ink-secondary">Promote your venue and track performance</p>
          </div>
        </div>

        {showSignup && !partner ? (
          <VenueSignupForm
            email={session?.user.email ?? ''}
            onCreated={(p) => {
              setPartner(p);
              setShowSignup(false);
            }}
          />
        ) : partner && !editing ? (
          <VenueDashboard
            partner={partner}
            onEdit={() => setEditing(true)}
            onUpdated={setPartner}
          />
        ) : partner && editing ? (
          <VenueEditForm
            partner={partner}
            onCancel={() => setEditing(false)}
            onSaved={(p) => {
              setPartner(p);
              setEditing(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function VenueSignupForm({
  email,
  onCreated,
}: {
  email: string;
  onCreated: (p: VenuePartner) => void;
}) {
  const [businessName, setBusinessName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<VenueType>('food');
  const [instagram, setInstagram] = useState('');
  const [website, setWebsite] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState(email);
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [visitRate, setVisitRate] = useState('0.50');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!businessName.trim() || !address.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError('Business name, address, contact name, and email are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const coords = await geocodeAddress(address.trim());
      const p = await createVenuePartner({
        business_name: businessName.trim(),
        address: address.trim(),
        type,
        instagram_link: instagram.trim() || null,
        website: website.trim() || null,
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim(),
        monthly_budget_cents: monthlyBudget.trim() ? Math.round(parseFloat(monthlyBudget) * 100) : null,
        visit_rate_cents: Math.round(parseFloat(visitRate) * 100),
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
      });
      onCreated(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create venue profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-card border border-gold/20 bg-[#0d0d0d] p-6">
      <h2 className="mb-1 text-lg font-bold text-gold">Register Your Venue</h2>
      <p className="mb-6 text-sm text-ink-secondary">
        Get your venue featured in plans. You only pay $0.50 per confirmed visit — appearances and saves are free.
      </p>
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      <div className="space-y-4">
        <FormField icon={<Building2 size={16} />} label="Business Name">
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Brazico Churrasco" className={inputClass} />
        </FormField>
        <FormField icon={<MapPin size={16} />} label="Address">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full street address" className={inputClass} />
        </FormField>
        <FormField label="Venue Type">
          <select value={type} onChange={(e) => setType(e.target.value as VenueType)} className={`${inputClass} [color-scheme:dark]`}>
            <option value="food">Food</option>
            <option value="activity">Activity</option>
            <option value="dessert">Dessert</option>
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField icon={<Instagram size={16} />} label="Instagram (optional)">
            <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@yourvenue" className={inputClass} />
          </FormField>
          <FormField icon={<Globe size={16} />} label="Website (optional)">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." className={inputClass} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField icon={<User size={16} />} label="Contact Name">
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Your name" className={inputClass} />
          </FormField>
          <FormField icon={<Mail size={16} />} label="Contact Email">
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="you@venue.com" className={inputClass} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField icon={<DollarSign size={16} />} label="Monthly Budget (optional)">
            <input value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} type="number" min="0" step="0.01" placeholder="e.g. 100 (blank = unlimited)" className={inputClass} />
          </FormField>
          <FormField icon={<DollarSign size={16} />} label="Per-Visit Rate">
            <input value={visitRate} onChange={(e) => setVisitRate(e.target.value)} type="number" min="0.01" step="0.01" className={inputClass} />
          </FormField>
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3.5 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <><Loader2 size={18} className="animate-spin" /> Creating...</> : <><Save size={18} /> Submit for Approval</>}
        </button>
        <p className="text-center text-xs text-ink-secondary">
          Your venue will be reviewed before going live. You'll only be charged for confirmed visits.
        </p>
      </div>
    </div>
  );
}

function VenueDashboard({
  partner,
  onEdit,
  onUpdated,
}: {
  partner: VenuePartner;
  onEdit: () => void;
  onUpdated: (p: VenuePartner) => void;
}) {
  const [stats, setStats] = useState<VenueEventStats | null>(null);
  const [milestones, setMilestones] = useState<VenueMilestone[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [toggling, setToggling] = useState(false);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const [s, m] = await Promise.all([
        fetchVenueEventStats(partner.id, partner.visit_rate_cents),
        fetchVenueMilestones(partner.id),
      ]);
      setStats(s);
      setMilestones(m);
    } catch { /* ignore */ }
    finally { setLoadingStats(false); }
  }, [partner.id, partner.visit_rate_cents]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleToggleActive = async () => {
    setToggling(true);
    try {
      const updated = await updateVenuePartner(partner.id, { active: !partner.active });
      onUpdated(updated);
    } catch { /* ignore */ }
    finally { setToggling(false); }
  };

  const budgetUsed = stats?.thisMonthSpendCents ?? 0;
  const budgetLimit = partner.monthly_budget_cents;
  const budgetPct = budgetLimit ? Math.min(100, (budgetUsed / budgetLimit) * 100) : 0;
  const budgetRemaining = budgetLimit ? Math.max(0, budgetLimit - budgetUsed) : null;

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {!partner.approved && (
        <div className="flex items-center gap-3 rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertCircle size={18} /> Your venue is pending approval. We'll notify you once it's live.
        </div>
      )}

      {/* Venue profile summary */}
      <div className="rounded-card border border-gold/20 bg-[#0d0d0d] p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold text-white">{partner.business_name}</h2>
            <p className="mt-1 flex items-center gap-1 text-sm text-ink-secondary">
              <MapPin size={14} className="text-gold/70" /> {partner.address}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                partner.active && partner.approved
                  ? 'bg-success/15 text-success'
                  : 'bg-ink-secondary/15 text-ink-secondary'
              }`}>
                {partner.active && partner.approved ? <><Play size={10} /> Active</> : <><Pause size={10} /> Paused</>}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold capitalize text-gold">
                {partner.type}
              </span>
            </div>
          </div>
          <button
            onClick={onEdit}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gold/30 bg-black/40 px-3 py-2 text-sm font-medium text-gold transition-all hover:border-gold active:scale-95"
          >
            Edit
          </button>
        </div>
        {(partner.instagram_link || partner.website) && (
          <div className="mt-4 flex flex-wrap gap-3 border-t border-gold/10 pt-4">
            {partner.instagram_link && (
              <a href={partner.instagram_link.startsWith('http') ? partner.instagram_link : `https://${partner.instagram_link}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-gold/80 hover:text-gold">
                <Instagram size={14} /> Instagram
              </a>
            )}
            {partner.website && (
              <a href={partner.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-gold/80 hover:text-gold">
                <Globe size={14} /> Website
              </a>
            )}
          </div>
        )}
      </div>

      {/* Stats grid */}
      {loadingStats ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gold/50" />
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard icon={<Eye size={18} />} label="Impressions" value={stats.impressions} sub="Free" color="text-blue-400" />
            <StatCard icon={<Bookmark size={18} />} label="Saves" value={stats.saves} sub="Free" color="text-emerald-400" />
            <StatCard icon={<Footprints size={18} />} label="Visits" value={stats.visits} sub={`$${(partner.visit_rate_cents / 100).toFixed(2)} each`} color="text-gold" />
          </div>

          {/* Billing summary */}
          <div className="rounded-card border border-gold/20 bg-[#0d0d0d] p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gold/70">
              <DollarSign size={14} /> This Month
            </h3>
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-3xl font-bold text-white">${(budgetUsed / 100).toFixed(2)}</p>
                <p className="text-sm text-ink-secondary">{stats.thisMonthVisits} billable visit{stats.thisMonthVisits === 1 ? '' : 's'}</p>
              </div>
              {budgetRemaining !== null && (
                <div className="text-right">
                  <p className="text-sm font-semibold text-gold">${(budgetRemaining / 100).toFixed(2)}</p>
                  <p className="text-xs text-ink-secondary">remaining</p>
                </div>
              )}
            </div>
            {budgetLimit && (
              <div className="h-2 overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${budgetPct}%` }} />
              </div>
            )}
            {!budgetLimit && (
              <p className="text-xs text-ink-secondary">No monthly cap set — unlimited spending</p>
            )}
          </div>

          {/* Milestones */}
          <div className="rounded-card border border-gold/20 bg-[#0d0d0d] p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gold/70">
              <TrendingUp size={14} /> Milestones
            </h3>
            <div className="space-y-3">
              {(['visits', 'impressions', 'saves'] as const).map((mType) => {
                const current = mType === 'visits' ? stats.visits : mType === 'impressions' ? stats.impressions : stats.saves;
                const nextThreshold = MILESTONE_THRESHOLDS.find((t) => t > current) ?? MILESTONE_THRESHOLDS[MILESTONE_THRESHOLDS.length - 1];
                const reached = milestones.filter((m) => m.milestone_type === mType).map((m) => m.threshold);
                const pct = Math.min(100, (current / nextThreshold) * 100);
                return (
                  <div key={mType}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-medium capitalize text-white">{mType}</span>
                      <span className="text-xs text-ink-secondary">{current} / {nextThreshold}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-black/40">
                      <div className="h-full rounded-full bg-gold/70 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    {reached.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {reached.map((t) => (
                          <span key={t} className="inline-flex items-center gap-0.5 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                            <Check size={9} /> {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      {/* Pause/resume promotion */}
      {partner.approved && (
        <button
          onClick={handleToggleActive}
          disabled={toggling}
          className={`flex w-full items-center justify-center gap-2 rounded-card border py-3.5 text-base font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${
            partner.active
              ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/20'
              : 'border-success/30 bg-success/10 text-success hover:bg-success/20'
          }`}
        >
          {partner.active ? <><Pause size={18} /> Pause Promotion</> : <><Play size={18} /> Resume Promotion</>}
        </button>
      )}
    </div>
  );
}

function VenueEditForm({
  partner,
  onCancel,
  onSaved,
}: {
  partner: VenuePartner;
  onCancel: () => void;
  onSaved: (p: VenuePartner) => void;
}) {
  const [businessName, setBusinessName] = useState(partner.business_name);
  const [address, setAddress] = useState(partner.address);
  const [type, setType] = useState<VenueType>(partner.type);
  const [instagram, setInstagram] = useState(partner.instagram_link ?? '');
  const [website, setWebsite] = useState(partner.website ?? '');
  const [contactName, setContactName] = useState(partner.contact_name);
  const [contactEmail, setContactEmail] = useState(partner.contact_email);
  const [monthlyBudget, setMonthlyBudget] = useState(partner.monthly_budget_cents ? (partner.monthly_budget_cents / 100).toString() : '');
  const [visitRate, setVisitRate] = useState((partner.visit_rate_cents / 100).toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!businessName.trim() || !address.trim() || !contactName.trim() || !contactEmail.trim()) {
      setError('Business name, address, contact name, and email are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const coords = address.trim() !== partner.address ? await geocodeAddress(address.trim()) : null;
      const updated = await updateVenuePartner(partner.id, {
        business_name: businessName.trim(),
        address: address.trim(),
        type,
        instagram_link: instagram.trim() || null,
        website: website.trim() || null,
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim(),
        monthly_budget_cents: monthlyBudget.trim() ? Math.round(parseFloat(monthlyBudget) * 100) : null,
        visit_rate_cents: Math.round(parseFloat(visitRate) * 100),
        lat: coords?.lat ?? undefined as unknown as number,
        lon: coords?.lon ?? undefined as unknown as number,
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update venue.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-card border border-gold/20 bg-[#0d0d0d] p-6">
      <h2 className="mb-6 text-lg font-bold text-gold">Edit Venue Profile</h2>
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      <div className="space-y-4">
        <FormField icon={<Building2 size={16} />} label="Business Name">
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={inputClass} />
        </FormField>
        <FormField icon={<MapPin size={16} />} label="Address">
          <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="Venue Type">
          <select value={type} onChange={(e) => setType(e.target.value as VenueType)} className={`${inputClass} [color-scheme:dark]`}>
            <option value="food">Food</option>
            <option value="activity">Activity</option>
            <option value="dessert">Dessert</option>
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField icon={<Instagram size={16} />} label="Instagram (optional)">
            <input value={instagram} onChange={(e) => setInstagram(e.target.value)} className={inputClass} />
          </FormField>
          <FormField icon={<Globe size={16} />} label="Website (optional)">
            <input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputClass} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField icon={<User size={16} />} label="Contact Name">
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputClass} />
          </FormField>
          <FormField icon={<Mail size={16} />} label="Contact Email">
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputClass} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField icon={<DollarSign size={16} />} label="Monthly Budget (optional)">
            <input value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} type="number" min="0" step="0.01" placeholder="blank = unlimited" className={inputClass} />
          </FormField>
          <FormField icon={<DollarSign size={16} />} label="Per-Visit Rate">
            <input value={visitRate} onChange={(e) => setVisitRate(e.target.value)} type="number" min="0.01" step="0.01" className={inputClass} />
          </FormField>
        </div>
        <div className="flex gap-3">
          <button onClick={handleSave} disabled={saving} className="flex flex-1 items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black transition-all active:scale-[0.98] disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save Changes
          </button>
          <button onClick={onCancel} disabled={saving} className="flex items-center justify-center gap-2 rounded-card border border-gold/30 bg-black/40 px-6 py-3 text-sm font-medium text-ink-secondary transition-all active:scale-95">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: number; sub: string; color: string }) {
  return (
    <div className="rounded-card border border-gold/20 bg-[#0d0d0d] p-4">
      <div className={`mb-2 ${color}`}>{icon}</div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs font-medium text-ink-secondary">{label}</p>
      <p className="mt-0.5 text-[10px] text-ink-secondary/60">{sub}</p>
    </div>
  );
}

function FormField({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-ink-secondary">{label}</label>
      <div className="relative">
        {icon && <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/50">{icon}</div>}
        <div className={icon ? 'pl-10' : ''}>{children}</div>
      </div>
    </div>
  );
}

const inputClass = 'w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none';

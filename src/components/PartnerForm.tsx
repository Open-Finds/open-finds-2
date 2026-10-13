import { useEffect, useState, type FormEvent } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  adminCreatePartner, adminUpdatePartner, fetchVisitRate, ROLE_LABELS,
  type AdminPartner, type AdminPartnerInput, type TeamMember, type VenueType,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { AppSelect, VenueTypeSelect } from './ui/select';
import { AddressInput } from './AddressInput';

/** Dollars typed by a person, as cents; blank is "none". */
function toCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/**
 * Adds or edits a venue partner. Everyone's additions wait for the super
 * admin, who alone approves them; every venue pays the one rate the super
 * admin sets. Managers also pick who looks after a venue. The server
 * enforces the same split.
 */
export function PartnerForm({
  partner,
  canManage,
  canApprove = false,
  team = [],
  onClose,
  onSaved,
}: {
  partner: AdminPartner | null;
  /** Manager or super admin. */
  canManage: boolean;
  /** Super admin: approves. */
  canApprove?: boolean;
  team?: TeamMember[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { session } = useAuth();
  // New partners default to whoever adds them; '' is "nobody yet".
  const [manager, setManager] = useState<string>(partner ? partner.account_manager ?? '' : session?.user.id ?? '');
  const [businessName, setBusinessName] = useState(partner?.business_name ?? '');
  const [social, setSocial] = useState(partner?.instagram_link ?? '');
  const [contactName, setContactName] = useState(partner?.contact_name ?? '');
  const [email, setEmail] = useState(partner?.contact_email ?? '');
  const [phone, setPhone] = useState(partner?.contact_phone ?? '');
  const [address, setAddress] = useState(partner?.address ?? '');
  const [type, setType] = useState<VenueType>((partner?.type as VenueType) ?? 'food');
  const [budget, setBudget] = useState(partner?.monthly_budget_cents != null ? (partner.monthly_budget_cents / 100).toFixed(2) : '');
  const [website, setWebsite] = useState(partner?.website ?? '');
  // Shown, not edited: one rate for every venue, set in the admin dashboard.
  const [rateCents, setRateCents] = useState<number | null>(partner?.visit_rate_cents ?? null);
  useEffect(() => {
    if (!partner) fetchVisitRate().then(setRateCents, () => {});
  }, [partner]);
  const [approved, setApproved] = useState(partner?.approved ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!businessName.trim() || !contactName.trim() || !email.trim() || !address.trim()) {
      setError('Business name, contact name, email and address are all needed.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("That email doesn't look right.");
      return;
    }
    const budgetCents = toCents(budget);
    if (Number.isNaN(budgetCents)) {
      setError('The budget is a dollar amount, like 250.');
      return;
    }
    const input: AdminPartnerInput = {
      business_name: businessName.trim(),
      contact_name: contactName.trim(),
      contact_email: email.trim(),
      contact_phone: phone.trim() || null,
      address: address.trim(),
      type,
      monthly_budget_cents: budgetCents,
      website: website.trim() || null,
      instagram_link: social.trim() || null,
      ...(canManage ? { account_manager: manager || null } : {}),
      ...(canApprove
        ? {
            approved,
            // Approving clears an earlier rejection; leaving it unapproved keeps the reason.
            rejection_reason: approved ? null : partner?.rejection_reason ?? null,
          }
        : {}),
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

  const field = 'w-full rounded-md border border-input bg-card dark:bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring';

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {partner ? `Edit ${partner.business_name}` : canManage ? 'Add venue partner' : 'Submit new venue'}
          </DialogTitle>
          <DialogDescription>
            {partner
              ? 'Changes show in the app straight away.'
              : canApprove
                ? 'Details and budget. Every venue pays the same rate.'
                : 'It goes live once the super admin approves it. Follow it in My Venues.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Labeled label="Business name"><input className={field} value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Pocket Burger" /></Labeled>
          <Labeled label="Instagram / TikTok link (optional)"><input className={field} value={social} onChange={(e) => setSocial(e.target.value)} placeholder="https://instagram.com/…" /></Labeled>
          <Labeled label="Contact name"><input className={field} value={contactName} onChange={(e) => setContactName(e.target.value)} /></Labeled>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Email"><input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Labeled>
            <Labeled label="Phone (optional)"><input className={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Labeled>
          </div>
          <Labeled label="Address"><AddressInput className={field} value={address} onChange={setAddress} placeholder="Start typing the address" ariaLabel="Address" /></Labeled>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Type"><VenueTypeSelect value={type} onChange={setType} /></Labeled>
            <Labeled label="Monthly budget ($)"><input className={field} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" /></Labeled>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Website (optional)"><input className={field} value={website} onChange={(e) => setWebsite(e.target.value)} /></Labeled>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Rate per review / visit</span>
              <p className="rounded-md border border-border bg-background px-4 py-2.5 text-sm text-foreground">
                {rateCents == null ? '…' : `$${(rateCents / 100).toFixed(2)}`} <span className="text-xs text-muted-foreground">· same for every venue</span>
              </p>
            </div>
          </div>
          {canManage && team.length > 0 && (
            <Labeled label="Account manager (who looks after them, and earns the commission)">
              <AppSelect
                value={manager || 'none'}
                onChange={(v) => setManager(v === 'none' ? '' : v)}
                ariaLabel="Account manager"
                options={[
                  { value: 'none', label: 'Nobody yet' },
                  ...team.map((m) => ({ value: m.id, label: `${m.display_name ?? m.email} (${ROLE_LABELS[m.role]})` })),
                ]}
              />
            </Labeled>
          )}
          {canApprove && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="size-4 accent-primary" />
              Live in the app (approved)
            </label>
          )}
          {error && <p role="alert" className="rounded-md border border-destructive-text/30 bg-destructive-soft px-4 py-2.5 text-sm text-destructive-text">{error}</p>}
          <div className="mt-2 flex gap-3">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? <Loader2 className="animate-spin" /> : <Check />} {partner ? 'Save changes' : canManage ? 'Add partner' : 'Submit venue'}
            </Button>
            <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

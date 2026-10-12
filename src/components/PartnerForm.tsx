import { useState, type FormEvent } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  adminCreatePartner, adminUpdatePartner, ROLE_LABELS,
  type AdminPartner, type AdminPartnerInput, type TeamMember, type VenueType,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { AppSelect, VenueTypeSelect } from './ui/select';

/** Dollars typed by a person, as cents; blank is "none". */
function toCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

/**
 * Adds or edits a venue partner. Workers submit their own (live straight
 * away, at the rate they agreed); managers also approve and pick who looks
 * after it. The server enforces the same split.
 */
export function PartnerForm({
  partner,
  canManage,
  team = [],
  onClose,
  onSaved,
}: {
  partner: AdminPartner | null;
  /** Manager or super admin. */
  canManage: boolean;
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
  const [rate, setRate] = useState(((partner?.visit_rate_cents ?? 10) / 100).toFixed(2));
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
    const rateCents = toCents(rate);
    if (Number.isNaN(budgetCents) || rateCents == null || Number.isNaN(rateCents)) {
      setError('Budget and rate are dollar amounts, like 250 or 0.10.');
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
      visit_rate_cents: rateCents,
      ...(canManage
        ? {
            approved,
            // Approving clears an earlier rejection; leaving it unapproved keeps the reason.
            rejection_reason: approved ? null : partner?.rejection_reason ?? null,
            account_manager: manager || null,
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

  const field = 'w-full rounded-card border border-gold/20 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold';

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {partner ? `Edit ${partner.business_name}` : canManage ? 'Add venue partner' : 'Submit new venue'}
          </DialogTitle>
          <DialogDescription>
            {partner
              ? 'Changes show in the app straight away.'
              : canManage
                ? 'Details, budget and rate.'
                : 'It goes live in the app straight away, and shows in My Venues.'}
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
          <Labeled label="Address"><input className={field} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, suburb, state, postcode" /></Labeled>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Type"><VenueTypeSelect value={type} onChange={setType} /></Labeled>
            <Labeled label="Monthly budget ($)"><input className={field} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" /></Labeled>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Website (optional)"><input className={field} value={website} onChange={(e) => setWebsite(e.target.value)} /></Labeled>
            <Labeled label="Rate per review / visit ($)"><input className={field} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Labeled>
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
          {canManage && (
            <label className="flex items-center gap-2 text-sm text-white">
              <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="size-4 accent-[#D4AF35]" />
              Live in the app (approved)
            </label>
          )}
          {error && <p role="alert" className="rounded-card border border-red-400/40 bg-red-400/10 px-4 py-2.5 text-sm text-red-200">{error}</p>}
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
      <span className="text-xs font-semibold text-ink-secondary">{label}</span>
      {children}
    </label>
  );
}

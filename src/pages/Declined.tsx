import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import {
  fetchPlan,
  fetchRsvps,
  type Plan,
  type Rsvp,
  setRsvpDeclineReason,
} from '../lib/supabase';
import { RsvpList } from '../components/Shared';
import { AppSelect } from '../components/ui/select';
import { Frown, Send } from 'lucide-react';

const REASONS = [
  'Got plans already',
  'Not feeling it',
  'Too far',
  'Other',
] as const;

function getRsvpIdFromHash() {
  const hash = window.location.hash;
  const idx = hash.indexOf('?');
  if (idx === -1) return null;
  const params = new URLSearchParams(hash.slice(idx + 1));
  return params.get('rsvp');
}

export function DeclinedPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState<string>('');
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [p, r] = await Promise.all([fetchPlan(id), fetchRsvps(id)]);
        if (!active) return;
        setPlan(p);
        setRsvps(r);
      } catch {
        // plan stays null → "Plan not found" shown below
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-ink-secondary">Loading...</p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-danger">Plan not found.</p>
      </div>
    );
  }

  const confirmedCount = rsvps.filter((r) => r.status === 'in').length;

  const handleSend = async () => {
    const rsvpId = getRsvpIdFromHash();
    if (!rsvpId) {
      setError('Could not find your RSVP. Try RSVPing again.');
      return;
    }
    const finalReason =
      reason === 'Other' ? otherText.trim() || 'Other' : reason;
    if (!finalReason) {
      setError('Please pick a reason.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // A guest has no UPDATE rights on rsvps; this RPC is the narrow path.
      await setRsvpDeclineReason(rsvpId, finalReason);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-8">
      <div className="text-center animate-fade-in">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border-2 border-danger/40 bg-danger/10">
          <Frown className="text-danger" size={28} />
        </div>
        <h1 className="text-2xl font-bold">Can't make it?</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          No worries — let {plan.host_name} know why.
        </p>
      </div>

      {done ? (
        <div className="card mt-6 text-center">
          <p className="text-white">
            Thanks — {plan.host_name} will know you can't make it.
          </p>
          <button
            onClick={() => navigate(`/plan/${id}`)}
            className="btn-secondary mt-4 w-full"
          >
            Back to RSVP
          </button>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <label className="mb-2 block text-sm font-medium text-ink-secondary">
              Reason
            </label>
            <AppSelect
              value={reason}
              onChange={setReason}
              placeholder="Pick a reason"
              ariaLabel="Reason"
              className="touch-target bg-surface focus:shadow-gold-glow data-[state=open]:shadow-gold-glow"
              options={REASONS.map((r) => ({ value: r, label: r }))}
            />
            {reason === 'Other' && (
              <input
                type="text"
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Tell us more"
                className="mt-3 w-full touch-target rounded-card border border-gold/20 bg-surface px-4 text-white placeholder-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
              />
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            onClick={handleSend}
            disabled={submitting}
            className="btn-primary mt-6 w-full disabled:opacity-40"
          >
            <Send size={18} /> {submitting ? 'Sending...' : 'Send'}
          </button>

          <p className="mt-6 text-center text-sm text-ink-secondary">
            Changed your mind?{' '}
            <button
              onClick={() => {
                const rsvpId = getRsvpIdFromHash();
                navigate(`/plan/${id}/confirmed?rsvp=${rsvpId ?? ''}`);
              }}
              className="font-semibold text-gold underline transition-colors hover:text-gold-light"
            >
              Actually I'm in!
            </button>
          </p>
        </>
      )}

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Who's Coming</h2>
          <span className="text-sm text-ink-secondary">
            {confirmedCount}/{rsvps.length} confirmed
          </span>
        </div>
        <RsvpList rsvps={rsvps} />
      </section>
    </div>
  );
}

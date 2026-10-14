import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, MapPin, Loader2, Store, ShieldCheck, Lock } from 'lucide-react';
import {
  fetchAdminPartners, fetchMySales, partnerStatus, isManagerRole, isTeam,
  type AdminPartner, type SalesSummary,
} from '../lib/supabase';
import { navigate } from '../lib/router';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { PartnerForm } from '../components/PartnerForm';
import { RatingLine, Stat, StatusBadge, Badge } from '../components/PartnerBits';
import { money, typeWithIcon } from '../lib/partners';
import { LoadError } from '../components/LoadError';

/**
 * A worker's dashboard (Robert's spec): submit venue partners, see their own
 * and how each is doing, and their commission. Managers and the super admin
 * get it too, for the venues they signed up themselves.
 */
export function MyVenuesPage() {
  const { role, session, profileLoaded } = useAuth();
  const me = session?.user.id;
  const [venues, setVenues] = useState<AdminPartner[]>([]);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminPartner | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, summary] = await Promise.all([
        fetchAdminPartners(),
        // The page still lists venues without the numbers.
        fetchMySales().catch(() => null),
      ]);
      // Managers' list holds everyone's; this page is the ones they signed up.
      setVenues(list.filter((p) => p.account_manager === me));
      setSales(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your venues.");
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    if (isTeam(role)) void load();
  }, [role, load]);

  if (!profileLoaded) return <div className="min-h-screen bg-background" />;

  if (!isTeam(role)) {
    return (
      <div className="min-h-screen bg-background px-6 pt-20 pb-28">
        <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-8 text-center">
          <Lock size={28} className="mx-auto mb-3 text-muted-foreground" />
          <p className="font-semibold text-foreground">My Venues is for The Unsaved team.</p>
          <p className="mt-1 text-sm text-muted-foreground">Ask the super admin to make you a worker.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 pt-20 pb-28 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-1 flex items-center gap-3">
          <Store size={26} className="text-muted-foreground" />
          <h1 className="text-title text-foreground">My Venues</h1>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">Venues you've signed up, how they're doing, and your commission.</p>

        {isManagerRole(role) && (
          <button
            onClick={() => navigate('/admin')}
            className="mb-4 flex w-full items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted"
          >
            <span className="flex items-center gap-2"><ShieldCheck size={16} /> Admin dashboard</span>
            <span aria-hidden>→</span>
          </button>
        )}

        <Button full onClick={() => setEditing('new')} className="mb-5">
          <Plus /> Submit New Venue
        </Button>

        {error ? (
          <LoadError onRetry={() => void load()} />
        ) : loading && venues.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {venues.length === 0 ? (
              <div className="rounded-lg border border-border bg-card p-8 text-center">
                <Store size={28} className="mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No venues yet. Submit your first one: it goes live once the super admin approves it.</p>
              </div>
            ) : (
              <section aria-label="Your venues" className="overflow-hidden rounded-md border border-border bg-card">
                <ul className="divide-y divide-border">
                  {venues.map((p) => {
                    const status = partnerStatus(p);
                    return (
                      <li key={p.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-bold text-foreground">{p.business_name}</p>
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin size={12} className="shrink-0 text-muted-foreground" /> <span className="truncate">{p.address}</span></p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Badge tone="gold">{typeWithIcon(p.type)}</Badge>
                            <StatusBadge status={status} />
                          </div>
                        </div>
                        {status === 'pending' && (
                          <p className="mt-2 text-xs text-warning">Waiting for the super admin to approve it.</p>
                        )}
                        {status === 'rejected' && (
                          <p className="mt-2 rounded-md border border-destructive-text/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-text">
                            Rejected by the super admin: {p.rejection_reason}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span>{p.impressions} appearances · {p.visits} visits · {money(p.total_billed_cents)} billed</span>
                            <RatingLine average={p.average_rating} count={p.review_count} />
                          </p>
                          <Button size="sm" variant="outline" onClick={() => setEditing(p)}><Pencil className="text-info" /> Edit</Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="border-t border-border px-4 py-2 text-right text-xs text-muted-foreground">({venues.length})</p>
              </section>
            )}

            {sales && (
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Stat
                  label="Commission earned"
                  value={money(sales.total_commission_cents)}
                  hint={`${sales.commission_percent}% of what your venues are billed · ${money(sales.unpaid_cents)} not paid yet`}
                />
                <Stat label="Venues submitted" value={String(sales.clients)} hint={`${sales.live} live${sales.rejected ? ` · ${sales.rejected} rejected` : ''}`} />
                <Stat label="Total appearances" value={String(sales.impressions)} hint="Times your venues were shown" />
                <Stat label="Total visits" value={String(sales.visits)} hint="Each review counts as a visit" />
              </div>
            )}
          </>
        )}

        {editing && (
          <PartnerForm
            partner={editing === 'new' ? null : editing}
            canManage={false}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await load(); }}
          />
        )}
      </div>
    </div>
  );
}

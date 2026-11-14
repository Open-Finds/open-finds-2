import { useEffect, useMemo, useRef, useState } from 'react';
import { AiSaveDialog } from './AiSaveDialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { LoginPage } from '../pages/Login';
import { useAuth } from '../context/AuthContext';
import { nativeShare, sourceUrl, type AndroidShare, type SharedVenue, type SharedVenueProgress } from '../lib/aiSave';
import { linkFromShare } from '../lib/shareTarget';

const title = 'AI Save or Create Plan';

function parseShareLink(text: string | undefined) {
  try {
    const link = linkFromShare(new URLSearchParams({ text: text ?? '' }));
    return link ? sourceUrl(link) : null;
  } catch {
    return null;
  }
}

function restoreProgress(value: string | undefined, owner: string | undefined): SharedVenueProgress | undefined {
  if (!value || !owner) return;
  try {
    const checkpoint = JSON.parse(value);
    if (checkpoint.owner === owner) return checkpoint.progress;
  } catch { /* The original link can still be used. */ }
}

export function AndroidShareSheet({ initialShare }: { initialShare: AndroidShare }) {
  const { session, loading } = useAuth();
  const owner = session?.user.id;
  const [share, setShare] = useState(initialShare);
  const [error, setError] = useState('');
  const link = parseShareLink(share.text);
  const initialProgress = useMemo(() => restoreProgress(share.checkpoint, owner), [share.checkpoint, owner]);
  const dismiss = () => { void nativeShare.dismiss({ id: share.id }).catch(() => {}); };

  useEffect(() => {
    let active = true;
    const read = async () => {
      const value = await nativeShare.getShare();
      if (!active || !value.id) return;
      setError('');
      setShare(current => current.id === value.id ? current : { ...value, id: value.id! });
    };
    const listener = nativeShare.addListener('incoming', () => { void read().catch(() => {}); });
    void listener.then(() => { if (active) return read(); }).catch(() => {});
    return () => {
      active = false;
      void listener.then(handle => handle.remove()).catch(() => {});
    };
  }, []);

  if (link && owner && !loading) return <>
    {error && <p role="alert" className="fixed inset-x-4 top-8 z-[60] rounded-lg bg-card p-3">{error}</p>}
    <AiSaveDialog key={share.id + ':' + owner} compact link={link} onClose={dismiss}
      initialProgress={initialProgress}
      onProgress={({ candidates, verified, identification }) => {
        if (!candidates && !verified && !identification?.metadata) return;
        // Keep source evidence for verification retries across activity recreation.
        const venueProgress = { candidates, verified };
        const value = JSON.stringify({
          owner,
          progress: verified ? venueProgress : { ...venueProgress, identification },
        });
        void nativeShare.remember({
          id: share.id,
          value: value.length <= 32_000 ? value : JSON.stringify({ owner, progress: venueProgress }),
        }).catch(() => {});
      }}
      onPlan={venue => {
        void nativeShare.openPlan({ id: share.id, value: JSON.stringify({ owner, venue }) })
          .catch(() => setError('Could not open the planner. Try again.'));
      }}
    />
  </>;

  return <Dialog open onOpenChange={open => { if (!open) dismiss(); }}>
    <DialogContent>
      <img className="size-8 rounded-lg" src="/icon-512.png" alt="The Unsaved" />
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{!link ? 'Share an HTTPS venue link to continue.'
        : loading ? 'Checking your session…' : 'Sign in to continue with this link.'}</DialogDescription>
      {link && !loading && <LoginPage compact />}
    </DialogContent>
  </Dialog>;
}

export function PendingAndroidSharePlan({ owner, onPlan }: { owner: string; onPlan: (venue: SharedVenue) => void }) {
  const handler = useRef(onPlan);
  handler.current = onPlan;
  useEffect(() => {
    let active = true;
    const read = async () => {
      const { value } = await nativeShare.takePlan();
      if (!active || !value) return;
      const plan = JSON.parse(value);
      if (plan.owner === owner && plan.venue?.name && plan.venue?.address) handler.current(plan.venue);
    };
    const listener = nativeShare.addListener('plan', () => { void read().catch(() => {}); });
    void listener.then(() => { if (active) return read(); }).catch(() => {});
    return () => {
      active = false;
      void listener.then(handle => handle.remove()).catch(() => {});
    };
  }, [owner]);
  return null;
}

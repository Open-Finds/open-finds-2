import { useState } from 'react';
import { UserPlus, MessageSquare, Copy, MoreHorizontal, Check } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import { ShareOnSocialDialog } from './ShareOnSocial';
import { InviteFriendsModal } from './InviteFriendsModal';
import { buildInviteMessage, getShareUrl, copyToClipboard } from '../lib/invite';
import type { Plan, Stop } from '../lib/supabase';

export function EventShareSheet({ plan, stops, open, onClose }: { plan: Plan; stops: Stop[]; open: boolean; onClose: () => void }) {
  const [invite, setInvite] = useState(false);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const url = getShareUrl(plan.id);
  const message = buildInviteMessage(plan);
  const copy = async () => { if (await copyToClipboard(url)) setCopied(true); else setError('Clipboard access failed. Select and copy the link below.'); };
  return <><Sheet open={open && !invite && !more} onOpenChange={(value) => !value && onClose()}><SheetContent side="bottom" className="lg:mx-auto lg:max-w-xl"><SheetHeader><SheetTitle>Share your plan</SheetTitle><SheetDescription>Friends count as confirmed guests once they RSVP.</SheetDescription></SheetHeader>
    <div className="my-5 rounded-lg border border-border bg-background p-4"><p className="text-caption text-muted-foreground">{plan.date} · {stops[0]?.time || 'Time to be agreed'}</p>{plan.end_time && <p className="mt-1 text-small text-muted-foreground">Ends {plan.end_date} at {plan.end_time.slice(0, 5)}</p>}<h3 className="mt-2 text-heading">{plan.title}</h3><p className="mt-2 text-small text-muted-foreground">{stops.map((s) => s.name).join(' → ')}</p></div>
    <div className="flex items-center gap-2 rounded-md border border-input p-3"><input aria-label="Event share link" readOnly value={url} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-small" /><button className="btn-secondary btn-sm" onClick={copy}>{copied ? <Check size={16} /> : 'Copy'}</button></div>
    {error && <p role="alert" className="mt-3 text-small text-destructive-text">{error}</p>}
    <div className="mt-5 grid grid-cols-4 gap-2"><button className="ux-stat items-center px-2 text-small" onClick={() => setInvite(true)}><UserPlus size={20} />Invite</button>
      <a className="ux-stat items-center px-2 text-small" href={`sms:?body=${encodeURIComponent(`${message}\n${url}`)}`}><MessageSquare size={20} />Message</a>
      <button className="ux-stat items-center px-2 text-small" onClick={copy}><Copy size={20} />{copied ? 'Copied' : 'Copy Link'}</button>
      <button className="ux-stat items-center px-2 text-small" onClick={() => setMore(true)}><MoreHorizontal size={20} />More</button></div>
    <p className="mt-4 text-small text-muted-foreground">Anyone with this link can view the event and RSVP without an account. Messaging support depends on your device.</p>
  </SheetContent></Sheet>
    <InviteFriendsModal open={invite && open} onClose={() => setInvite(false)} planId={plan.id} />
    <ShareOnSocialDialog open={more && open} onClose={() => setMore(false)} title={plan.title} message={message} url={url} />
  </>;
}

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { copyToClipboard } from '../lib/invite';

const OPTION =
  'flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-6 py-3 text-sm font-bold text-primary-text transition-all active:scale-[0.98] hover:bg-muted';

/**
 * Sharing for everyone, with or without the app: the link opens the plan and
 * lets anyone RSVP. WhatsApp and Telegram open straight into a message;
 * Instagram, Messages and the rest go through the phone's share menu.
 * In-app invitations to friends are InviteFriendsModal.
 */
export function ShareOnSocialDialog({
  open,
  onClose,
  title,
  message,
  url,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The invitation, without the link. */
  message: string;
  url: string;
}) {
  const [copied, setCopied] = useState(false);
  const full = `${message}\n${url}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    if (await copyToClipboard(full)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const shareMore = async () => {
    try {
      await navigator.share({ title, text: message, url });
    } catch { /* cancelled */ }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-foreground">Share on Social</DialogTitle>
          <DialogDescription>Anyone with the link can see the plan and RSVP, no app needed.</DialogDescription>
        </DialogHeader>
        <p className="break-words rounded-lg border border-border bg-background px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {message} <span className="text-muted-foreground">{url}</span>
        </p>
        <div className="grid gap-3">
          <button
            onClick={copy}
            className="btn-primary w-full"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? 'Copied!' : 'Copy link'}
          </button>
          <a href={`https://wa.me/?text=${encodeURIComponent(full)}`} target="_blank" rel="noopener noreferrer" className={OPTION}>
            <span aria-hidden="true">💬</span> WhatsApp
          </a>
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={OPTION}
          >
            <span aria-hidden="true">✈️</span> Telegram
          </a>
          {canShare && (
            <button onClick={shareMore} className={OPTION}>
              <Share2 size={18} /> Instagram, Messages & more
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

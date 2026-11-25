import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { describeProbe, phoneCheckEnabled, probePost, type PhoneProbe } from '../lib/phoneProbe';
import { copyToClipboard } from '../lib/invite';

/**
 * Test builds only: shows what the phone itself could read from the shared TikTok or Instagram post (caption, location tag,
 * photo slides, video link, media file), so the way to read venues named only in the video can be built on facts.
 * It runs by itself, makes no AI call, and "Copy results" puts the lines on the clipboard to paste into a message.
 */
export function PhoneCheck({ link }: { link: string }) {
  const enabled = phoneCheckEnabled(link);
  const [probe, setProbe] = useState<PhoneProbe>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setProbe(undefined);
    void probePost(link).then(result => { if (active) setProbe(result); });
    return () => { active = false; };
  }, [link, enabled]);

  if (!enabled) return null;
  const lines = probe ? describeProbe(link, probe) : [];
  return <details className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
    <summary className="cursor-pointer">{probe ? 'Phone check (test build): done' : 'Phone check (test build): checking…'}</summary>
    {probe && <div className="mt-2 grid gap-2">
      <ul className="grid gap-0.5 break-words">{lines.slice(2).map(line => <li key={line}>{line}</li>)}</ul>
      <Button type="button" size="sm" variant="outline" onClick={async () => { setCopied(await copyToClipboard(lines.join('\n'))); }}>
        {copied ? 'Copied' : 'Copy results'}
      </Button>
    </div>}
  </details>;
}

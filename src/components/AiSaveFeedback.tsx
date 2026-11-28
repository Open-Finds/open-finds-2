import { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { REASON_LABELS, type Rating, type Reason } from '../lib/aiSaveResults';

export type FeedbackValue = { rating: Rating; reason?: Reason; note?: string };

/**
 * "Was this the right venue?" with a thumbs up and a thumbs down. A thumbs down is recorded straight away, then offers
 * one-tap reasons and an optional short note, each of which updates the same record. The answer can be changed.
 */
export function AiSaveFeedback({ value, onRate }: { value?: FeedbackValue; onRate: (value: FeedbackValue) => void }) {
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState('');
  const asking = !value || changing;

  if (!asking && value?.rating === 'like') {
    return <p className="flex items-center gap-2 text-small text-muted-foreground" role="status">
      <ThumbsUp size={16} aria-hidden="true" /> Thanks, noted.
      <button type="button" className="text-info underline" onClick={() => setChanging(true)}>Change</button>
    </p>;
  }

  if (!asking && value?.rating === 'dislike') {
    return <div className="grid gap-2" role="group" aria-label="What went wrong?">
      <p className="text-small text-muted-foreground">Sorry about that. What went wrong?</p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(REASON_LABELS) as Reason[]).map(reason => (
          <Button key={reason} type="button" size="sm" variant={value.reason === reason ? 'secondary' : 'outline'} aria-pressed={value.reason === reason}
            onClick={() => onRate({ rating: 'dislike', reason, note: note.trim() || value.note })}>{REASON_LABELS[reason]}</Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input aria-label="Add a note (optional)" placeholder="Add a note (optional)" maxLength={200} value={note} onChange={event => setNote(event.target.value)} />
        <Button type="button" size="sm" variant="outline" disabled={!note.trim()}
          onClick={() => onRate({ rating: 'dislike', reason: value.reason, note: note.trim() })}>Send</Button>
      </div>
      <button type="button" className="w-fit text-small text-info underline" onClick={() => setChanging(true)}>Change my answer</button>
    </div>;
  }

  return <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Was this the right venue?">
    <span className="text-small text-muted-foreground">Was this the right venue?</span>
    <Button type="button" size="sm" variant="outline" onClick={() => { setChanging(false); onRate({ rating: 'like' }); }}>
      <ThumbsUp aria-hidden="true" /> Yes
    </Button>
    <Button type="button" size="sm" variant="outline" onClick={() => { setChanging(false); onRate({ rating: 'dislike' }); }}>
      <ThumbsDown aria-hidden="true" /> No
    </Button>
  </div>;
}

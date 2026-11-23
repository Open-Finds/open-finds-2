import { useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { ADDRESS_TOKEN, insertAtCursor, nextPreset, PRESET_MESSAGES, VENUE_TOKEN } from '../lib/shareMessage';

/**
 * The optional message that goes with a Quick Share. It can be written while the venue is still being checked:
 * the venue-name and address chips add a placeholder that is filled with the verified details when the message is sent.
 */
export function ShareMessageComposer({ value, onChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [preset, setPreset] = useState<string>(PRESET_MESSAGES[0]);

  const insert = (text: string) => {
    const element = box.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const next = insertAtCursor(value, text, start, end);
    onChange(next.value);
    // Put the cursor after what was added once React has written the new text.
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return <div className="grid gap-2">
    <Textarea ref={box} aria-label="Write a message" placeholder="Write a message" rows={2} maxLength={280} disabled={disabled}
      className="min-h-0 resize-none border-transparent bg-muted text-base dark:bg-muted"
      value={value} onChange={event => onChange(event.target.value)} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => insert(VENUE_TOKEN)}>Venue name</Button>
      <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => insert(ADDRESS_TOKEN)}>Address</Button>
    </div>
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled} className="h-auto min-h-9 min-w-0 whitespace-normal py-1.5 text-left"
        onClick={() => insert(preset)}>{preset}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label="Shuffle message" onClick={() => setPreset(nextPreset(preset))}>
        <Shuffle aria-hidden="true" />
      </Button>
    </div>
  </div>;
}

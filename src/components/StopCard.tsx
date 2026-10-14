import { useState } from 'react';
import { MapPin, Pencil, Save, X } from 'lucide-react';
import { updateStop, type Stop } from '../lib/supabase';
import { formatTime } from '../lib/time';
import { TimeSelect } from './ui/select';
import { CheckItOut } from './CheckItOut';

export function StopCard({
  stop,
  index,
  onSaved,
}: {
  stop: Stop;
  index: number;
  onSaved: (updated: Stop) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stop.name);
  const [address, setAddress] = useState(stop.address);
  const [time, setTime] = useState(stop.time);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setName(stop.name);
    setAddress(stop.address);
    setTime(stop.time);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (!name.trim() || !address.trim()) {
      setError('Name and address are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateStop(stop.id, {
        name: name.trim(),
        address: address.trim(),
        time,
      });
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="relative rounded-lg border border-border bg-card p-4">
        <button
          onClick={startEdit}
          aria-label="Edit stop"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-info transition-all hover:border-input hover:bg-info-soft active:scale-90"
        >
          <Pencil size={13} strokeWidth={2.5} />
        </button>
        <div className="flex items-center gap-3 pr-8">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-sm font-bold text-foreground">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-foreground">{formatTime(stop.time)}</span>
        </div>
        <h3 className="mt-2 font-bold text-foreground">{stop.name}</h3>
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <MapPin size={14} className="text-muted-foreground" /> {stop.address}
        </p>
        <CheckItOut link={stop.vibe_link} className="mt-3" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-input bg-card p-4 ring-1 ring-ring">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-sm font-bold text-foreground">
          {index + 1}
        </span>
        <TimeSelect value={time} onChange={setTime} className="min-w-0 flex-1" />
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Venue name"
        className="mb-2 w-full rounded-lg border border-input bg-card dark:bg-background px-3 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
      />
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Address"
        className="w-full rounded-lg border border-input bg-card dark:bg-background px-3 py-2 text-sm text-muted-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
      />
      {error && (
        <p className="mt-2 text-xs text-destructive-text">{error}</p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary btn-sm flex-1"
        >
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:text-foreground active:scale-[0.98]"
        >
          <X size={14} /> Cancel
        </button>
      </div>
    </div>
  );
}

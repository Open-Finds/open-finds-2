import { Reorder, useDragControls, useReducedMotion } from 'framer-motion';
import { GripVertical, Trash2 } from 'lucide-react';
import type { DraftStop } from '../lib/planner';
export function ItineraryItem({ stop, index, total, onMove, onRemove, onTime, journey }: {
  stop: DraftStop; index: number; total: number; onMove: (delta: number) => void; onRemove: () => void; onTime: (time: string) => void; journey?: string;
}) {
  const controls = useDragControls();
  const reduced = useReducedMotion();
  return <Reorder.Item value={stop} dragListener={false} dragControls={controls} whileDrag={{ scale: reduced ? 1 : 1.015, zIndex: 5 }} transition={{ duration: reduced ? 0 : 0.18 }} className="relative list-none">
    {index > 0 && <p className="my-3 text-center text-small text-info" aria-live="polite">↓ {journey || 'Journey estimate unavailable'}</p>}
    <article className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
      <button type="button" className="ux-icon touch-none shrink-0" style={{ touchAction: 'none' }} onPointerDown={(e) => controls.start(e)}
        onKeyDown={(e) => { const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : e.key === 'Home' ? -index : e.key === 'End' ? total - 1 - index : 0; if (delta) { e.preventDefault(); onMove(delta); } }}
        aria-label={`Reorder ${stop.name}, stop ${index + 1} of ${total}. Use arrow keys to move.`}><GripVertical size={20} /></button>
      <div className="min-w-0 flex-1"><h3 className="text-label">{index + 1}. {stop.name}</h3><p className="mt-1 text-small text-muted-foreground">{stop.address}</p>
        <label className="mt-3 block text-small">Stop time<input type="time" aria-label={`Time for ${stop.name}`} className="ux-field mt-2 block max-w-full" value={stop.time} onChange={(e) => onTime(e.target.value)} /></label>
      </div><button className="ux-icon shrink-0 text-destructive-text" aria-label={`Remove ${stop.name}`} onClick={onRemove}><Trash2 size={16} /></button>
    </article>
  </Reorder.Item>;
}

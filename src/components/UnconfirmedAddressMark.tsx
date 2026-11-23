import { AlertTriangle } from 'lucide-react';

/** Small warning mark shown next to any address Google did not confirm. */
export function UnconfirmedAddressMark() {
  return <span className="inline-flex shrink-0 items-center" role="img" aria-label="Address not confirmed on Google Maps" title="Address not confirmed on Google Maps">
    <AlertTriangle size={14} className="text-warning" aria-hidden="true" /></span>;
}

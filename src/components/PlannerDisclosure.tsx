import type { ReactNode } from 'react';
/** Small controls may stay mounted; inert prevents hidden keyboard interaction. */
export function PlannerDisclosure({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className="planner-disclosure" data-open={open} aria-hidden={!open} ref={node => { if (node) node.inert = !open; }}>
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>;
}

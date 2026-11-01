import type { RefObject } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { scrollToSection } from '../lib/flow';
export function FlowArrow({ target, label, up = false, ready = true }: { target: RefObject<HTMLElement>; label: string; up?: boolean; ready?: boolean }) {
  const Icon = up ? ArrowUp : ArrowDown;
  return <div className="my-7 flex flex-col items-center gap-2"><button type="button" className={`flow-arrow ${ready ? 'flow-ready' : ''}`} aria-label={label} disabled={!ready} onClick={() => scrollToSection(target)}><Icon size={22} /></button><span className="text-small text-muted-foreground">{label}</span></div>;
}

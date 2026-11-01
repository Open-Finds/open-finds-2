import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { scrollToSection } from '../lib/flow';
type Section = { label: string; target: RefObject<HTMLElement> };
/** Optional shortcuts; never intercept natural scrolling or require section completion. */
export function WorkflowNavigator({ sections, blocked = false }: { sections: Section[]; blocked?: boolean }) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(0);
  const [hidden, setHidden] = useState(false);
  const overlay = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const anchor = Math.min(200, window.innerHeight * .3);
      let index = 0;
      sections.forEach((s, i) => { if (s.target.current && s.target.current.getBoundingClientRect().height > 0 && s.target.current.getBoundingClientRect().top <= anchor) index = i; });
      setActive(index);
      const first = sections[0]?.target.current?.getBoundingClientRect();
      const last = sections[sections.length - 1]?.target.current?.getBoundingClientRect();
      if (first && last) {
        const start = first.top - anchor;
        const end = last.bottom - (window.innerHeight - 110);
        const range = end - start;
        setProgress(range > 0 ? Math.round(Math.max(0, Math.min(1, -start / range)) * 100) : first.top <= anchor ? 100 : 0);
      }
      const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
      const modal = [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].some(e => e.getClientRects().length > 0);
      const keyboard = !!window.visualViewport && window.visualViewport.height < window.innerHeight * .75;
      // Yield when an interactive target reaches the overlay's reserved viewport area.
      const mobile = window.innerWidth < 1024;
      const bottom = window.innerHeight - (mobile ? 110 : 28);
      const right = window.innerWidth - 12;
      const collision = [...document.querySelectorAll('.plan-section button, .plan-section input, .plan-section textarea, .plan-section select, .plan-section summary, .plan-section a, [role="alert"]')].some(e => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > right - 210 && r.left < right && r.bottom > bottom - 58 && r.top < bottom;
      });
      setHidden(!!editing || modal || keyboard || collision);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    measure();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    sections.forEach(s => { if (s.target.current) sizes?.observe(s.target.current); });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    const changes = new MutationObserver(schedule);
    changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'aria-expanded'] });
    return () => { cancelAnimationFrame(frame); sizes?.disconnect(); changes.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); document.removeEventListener('focusin', schedule); document.removeEventListener('focusout', schedule); window.visualViewport?.removeEventListener('resize', schedule); };
  }, [sections]);
  const next = sections[active + 1], previous = sections[active - 1];
  return <nav ref={overlay} className="workflow-nav" aria-label="Planner sections" hidden={blocked || hidden}>
    {previous && <button type="button" className="workflow-up" aria-label={`Previous section: ${previous.label}`} onClick={() => scrollToSection(previous.target)}><ArrowUp size={18} /></button>}
    <div><span className="workflow-label"><span>{progress}% · {next ? next.label : 'Review'}</span><span className="workflow-progress" role="progressbar" aria-label="Planner scroll progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}% of planner viewed`}><span style={{ transform: `scaleX(${progress / 100})` }} /></span></span><button key={active} type="button" className="workflow-next" aria-label={next ? `Go to ${next.label}` : 'Back to discovery'} onClick={() => scrollToSection((next ?? sections[0]).target)}>{next ? <ArrowDown size={23} /> : <ArrowUp size={23} />}</button></div>
  </nav>;
}

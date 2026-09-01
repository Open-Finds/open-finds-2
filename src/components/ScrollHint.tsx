import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Bouncing gold down-arrow that hints at scrollable content.
 * Fades out once the user scrolls down. Sits above the bottom nav bar.
 */
export function ScrollHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setVisible(window.scrollY < 24);
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-30 flex -translate-x-1/2 justify-center transition-opacity duration-300"
      style={{ bottom: '72px', opacity: visible ? 1 : 0 }}
    >
      <div className="animate-bounce-arrow rounded-full bg-gold/10 p-1.5 backdrop-blur-sm">
        <ChevronDown size={20} className="text-gold" />
      </div>
    </div>
  );
}

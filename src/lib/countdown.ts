import { useEffect, useState } from 'react';

export function useCountdown(targetDate: string) {
  const target = new Date(targetDate).getTime();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return { days, hours, minutes, seconds, isPast: diff === 0 };
}

export function formatCountdown(c: {
  days: number;
  hours: number;
  minutes: number;
}) {
  return `${c.days} day${c.days === 1 ? '' : 's'}, ${c.hours} hr${
    c.hours === 1 ? '' : 's'
  }, ${c.minutes} min`;
}

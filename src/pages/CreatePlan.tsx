import { useState } from 'react';
import { navigate } from '../lib/router';
import { Calendar, ChevronRight } from 'lucide-react';
import { BackButton } from '../components/Shared';

export function CreatePlanPage() {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');

  const canContinue = title.trim() && date;

  const handleNext = () => {
    if (!canContinue) return;
    sessionStorage.setItem('draft_title', title.trim());
    sessionStorage.setItem('draft_date', date);
    navigate('/create/build');
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-44 pt-10">
      <BackButton to="/" />
      <h1 className="text-2xl font-bold">What's the occasion?</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Give your plan a name and pick a date.
      </p>

      <div className="mt-8 space-y-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-ink-secondary">
            Occasion
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Saturday Night Out"
            className="w-full touch-target rounded-card border border-gold/20 bg-surface px-4 text-white placeholder-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-ink-secondary">
            Date
          </label>
          <div className="relative">
            <Calendar
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold"
              size={18}
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full touch-target rounded-card border border-gold/20 bg-surface pl-12 pr-4 text-white outline-none transition-all focus:border-gold focus:shadow-gold-glow"
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-20 left-1/2 z-50 flex w-[800px] max-w-[100vw] -translate-x-1/2 justify-center px-6">
        <button
          onClick={handleNext}
          disabled={!canContinue}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card px-6 py-3.5 text-base font-bold shadow-gold-glow transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500 disabled:shadow-none bg-gold text-black"
        >
          Curate a Date {!canContinue ? null : <ChevronRight size={20} />}
        </button>
      </div>
    </div>
  );
}

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
      <h1 className="text-title">What's the occasion?</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Give your plan a name and pick a date.
      </p>

      <div className="mt-8 space-y-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-muted-foreground">
            Occasion
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Saturday Night Out"
            className="w-full touch-target rounded-md border border-input bg-card px-4 text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-ring"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-muted-foreground">
            Date
          </label>
          <div className="relative">
            <Calendar
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-primary-text"
              size={18}
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full touch-target rounded-md border border-input bg-card pl-12 pr-4 text-foreground outline-none transition-all focus:border-ring"
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-24 left-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 justify-center px-6 lg:bottom-8 lg:left-64 lg:right-0 lg:mx-auto lg:translate-x-0">
        <button
          onClick={handleNext}
          disabled={!canContinue}
          className="btn-primary btn-lg w-full disabled:border disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
        >
          Curate a Date {!canContinue ? null : <ChevronRight size={20} />}
        </button>
      </div>
    </div>
  );
}

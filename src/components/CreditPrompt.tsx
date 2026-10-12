import { useEffect, useRef, useState } from 'react';
import { Coins } from 'lucide-react';
import { setCreditPrompt, type AIPurpose } from '../lib/openai';
import { fetchMyCredits } from '../lib/supabase';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

const USES: Record<AIPurpose, string> = {
  extract: 'link extractions',
  discover: 'Something New searches',
};

/**
 * Once a free account has used today's 3 link extractions or Something New
 * searches, offers to spend a credit on one more, if they have any. With
 * none, the usual "resets tomorrow" message shows instead.
 */
export function CreditPrompt() {
  const [ask, setAsk] = useState<{ purpose: AIPurpose; credits: number } | null>(null);
  const answerWith = useRef<((yes: boolean) => void) | null>(null);

  useEffect(() => {
    setCreditPrompt(async (purpose) => {
      const credits = await fetchMyCredits().catch(() => 0);
      if (credits < 1) return false;
      return new Promise<boolean>((resolve) => {
        answerWith.current = resolve;
        setAsk({ purpose, credits });
      });
    });
    return () => setCreditPrompt(null);
  }, []);

  const answer = (yes: boolean) => {
    answerWith.current?.(yes);
    answerWith.current = null;
    setAsk(null);
  };

  return (
    <Dialog open={!!ask} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white"><Coins size={18} className="text-gold" /> Use a credit?</DialogTitle>
          <DialogDescription>
            You've used today's 3 free {ask ? USES[ask.purpose] : ''}. Spend 1 credit for one more? You have {ask?.credits ?? 0}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" full onClick={() => answer(false)} className="sm:w-auto">Not now</Button>
          <Button full onClick={() => answer(true)} className="sm:w-auto"><Coins /> Use 1 credit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

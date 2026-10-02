import { useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, Lock } from 'lucide-react';
import { updateUserPassword } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Where a password-reset email lands. The link has already signed the user
 * in; this asks for the new password before anything else.
 */
export function ResetPasswordPage() {
  const { endPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Use at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateUserPassword(password);
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(
        /different from the old password/i.test(msg)
          ? "That's your current password. Choose a new one."
          : msg || "Couldn't save your new password. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const iconClass = 'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70';

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center bg-black px-5 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
            <KeyRound size={26} className="text-gold" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">{done ? 'Password updated' : 'Set a new password'}</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            {done ? "You're signed in. Use the new password next time." : 'Choose the password you’ll sign in with from now on.'}
          </p>
        </div>

        <div className="mt-8 rounded-card border border-gold/20 bg-surface p-5 sm:p-7">
          {done ? (
            <Button size="lg" full onClick={endPasswordRecovery} className="shadow-gold-glow">
              <Check size={18} /> Continue
            </Button>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              {error && (
                <div role="alert" className="rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                  {error}
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Lock size={17} className={iconClass} />
                  <Input
                    id="new-password"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 6 characters"
                    autoComplete="new-password"
                    className="pl-11 pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-secondary transition-colors hover:text-gold"
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <div className="relative">
                  <Lock size={17} className={iconClass} />
                  <Input
                    id="confirm-password"
                    type={show ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    className="pl-11"
                  />
                </div>
              </div>
              <Button type="submit" size="lg" full disabled={saving} className="mt-2 shadow-gold-glow">
                {saving ? <><Loader2 className="animate-spin" /> Saving…</> : 'Save new password'}
              </Button>
              <Button type="button" variant="ghost" full onClick={endPasswordRecovery} disabled={saving}>
                Not now
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

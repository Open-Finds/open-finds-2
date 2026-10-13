import { useState } from 'react';
import { AtSign, Check, Loader2, User, X } from 'lucide-react';
import { checkUsernameAvailable, upsertProfile } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Any account without a username (first Google sign-in, or an older email
 * account): usernames are how friends find each other. Asked once.
 */
export function ChooseUsernamePage() {
  const { session, refreshProfile } = useAuth();
  const meta = session?.user.user_metadata ?? {};
  // Google's name if there is one; never the email-based placeholder.
  const [displayName, setDisplayName] = useState<string>(
    (meta.full_name as string) || (meta.name as string) || ''
  );
  const [username, setUsername] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async (name: string) => {
    if (!name) return;
    try {
      setAvailable(await checkUsernameAvailable(name));
    } catch { /* checked again on save */ }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = username.trim().replace(/^@/, '').toLowerCase();
    if (!displayName.trim() || !clean) {
      setError('Add your name and pick a username.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!(await checkUsernameAvailable(clean))) {
        setAvailable(false);
        setError('That username is already taken. Try another.');
        return;
      }
      await upsertProfile(displayName.trim(), clean);
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const iconClass = 'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground';

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center bg-background px-5 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <img src="/the-unsaved-mark.png" alt="" width={72} height={72} />
          <h1 className="mt-3 text-title text-foreground">One last thing</h1>
          <p className="mt-2 text-sm text-muted-foreground">Pick a username so friends can find you.</p>
        </div>

        <form onSubmit={submit} className="mt-8 flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:p-7" noValidate>
          {error && (
            <div role="alert" className="rounded-md border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-text">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="choose-display-name">Display Name</Label>
            <div className="relative">
              <User size={17} className={iconClass} />
              <Input
                id="choose-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Robert Bui"
                autoComplete="name"
                className="pl-11"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="choose-username">Username</Label>
            <div className="relative">
              <AtSign size={17} className={iconClass} />
              <Input
                id="choose-username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase());
                  setAvailable(null);
                }}
                onBlur={() => check(username.trim())}
                placeholder="e.g. robbui"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="pl-11 pr-11"
              />
              {username.trim() && available !== null && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2">
                  {available ? <Check size={17} className="text-success" /> : <X size={17} className="text-destructive-text" />}
                </span>
              )}
            </div>
          </div>
          <Button type="submit" size="lg" full disabled={saving} className="mt-2">
            {saving ? <><Loader2 className="animate-spin" /> Saving…</> : 'Continue'}
          </Button>
        </form>
      </div>
    </div>
  );
}

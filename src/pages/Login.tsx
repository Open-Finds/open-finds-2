import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, LogIn, UserPlus, User, AtSign, Check, X, Loader2 } from 'lucide-react';
import { signIn, signUp, upsertProfile, checkUsernameAvailable } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export function LoginPage({ onBack }: { onBack?: () => void }) {
  const { refreshProfile } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      return;
    }
    if (mode === 'signup' && !displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (mode === 'signup' && !username.trim()) {
      setError('Username is required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const cleanUsername = username.trim().replace(/^@/, '').toLowerCase();
        const available = await checkUsernameAvailable(cleanUsername);
        if (!available) {
          setError('That username is already taken. Try another.');
          setLoading(false);
          return;
        }
        await signUp(email.trim(), password);
        await signIn(email.trim(), password);
        await upsertProfile(displayName.trim(), cleanUsername);
        await refreshProfile();
      } else {
        await signIn(email.trim(), password);
        // AuthContext picks up new session → App re-renders to home
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      if (msg.includes('Invalid login credentials')) {
        setError('Incorrect email or password.');
      } else if (msg.includes('User already registered')) {
        setError('An account with this email already exists. Sign in instead.');
      } else if (msg.includes('Password should be at least')) {
        setError('Password must be at least 6 characters.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const iconClass = 'pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70';

  return (
    // Phones fill the viewport; larger screens centre a bounded card instead
    // of stretching the form across the width of a monitor.
    <div className="flex min-h-screen min-h-[100dvh] flex-col items-center justify-center bg-black px-5 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-4xl font-black tracking-tight text-gold sm:text-5xl">Only</span>
            <span className="text-4xl font-black tracking-tight text-white sm:text-5xl">Finds</span>
          </div>
          <p className="text-sm text-ink-secondary">Discover venues. Build unforgettable nights.</p>
        </div>

        <div className="mt-8 rounded-card border border-gold/20 bg-surface p-5 sm:p-7">
          <Tabs value={mode} onValueChange={(v) => switchMode(v as 'signin' | 'signup')}>
            <TabsList className="w-full">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
          </Tabs>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4" noValidate>
            {mode === 'signup' && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="login-display-name">Display Name</Label>
                  <div className="relative">
                    <User size={17} className={iconClass} />
                    <Input
                      id="login-display-name"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Robert Bui"
                      autoComplete="name"
                      className="pl-11"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="login-username">Username</Label>
                  <div className="relative">
                    <AtSign size={17} className={iconClass} />
                    <Input
                      id="login-username"
                      type="text"
                      value={username}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
                        setUsername(clean);
                        setUsernameAvailable(null);
                      }}
                      onBlur={async () => {
                        if (username.trim()) {
                          try {
                            setUsernameAvailable(
                              await checkUsernameAvailable(username.trim().replace(/^@/, '').toLowerCase())
                            );
                          } catch { /* ignore */ }
                        }
                      }}
                      placeholder="e.g. robbui"
                      autoComplete="username"
                      className="pl-11 pr-11"
                    />
                    {username.trim() && usernameAvailable !== null && (
                      <span className="absolute right-4 top-1/2 -translate-y-1/2">
                        {usernameAvailable ? (
                          <Check size={17} className="text-success" />
                        ) : (
                          <X size={17} className="text-danger" />
                        )}
                      </span>
                    )}
                  </div>
                  {username.trim() && usernameAvailable === false && (
                    <p className="text-xs text-danger">That username is taken.</p>
                  )}
                  {username.trim() && usernameAvailable === true && (
                    <p className="text-xs text-success">Available!</p>
                  )}
                </div>
              </>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="login-email">Email</Label>
              <div className="relative">
                <Mail size={17} className={iconClass} />
                <Input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="pl-11"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="login-password">Password</Label>
              <div className="relative">
                <Lock size={17} className={iconClass} />
                <Input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  className="pl-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className={cn(
                    'absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full',
                    'text-ink-secondary transition-colors hover:text-gold',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  )}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <Button type="submit" size="lg" full disabled={loading} className="mt-2 shadow-gold-glow">
              {loading ? (
                <><Loader2 className="animate-spin" /> Loading…</>
              ) : mode === 'signin' ? (
                <><LogIn size={18} /> Sign In</>
              ) : (
                <><UserPlus size={18} /> Create Account</>
              )}
            </Button>
          </form>

          {onBack && (
            <Button variant="ghost" full onClick={onBack} className="mt-4">
              Back
            </Button>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-secondary/60">
          Your saved venues are private to your account.
        </p>
      </div>
    </div>
  );
}

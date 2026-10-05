import { useEffect, useState } from 'react';
import { Mail, Lock, Eye, EyeOff, LogIn, UserPlus, User, AtSign, Check, X, Loader2, ChevronLeft } from 'lucide-react';
import {
  signIn,
  signUp,
  upsertProfile,
  checkUsernameAvailable,
  sendPasswordReset,
  signInWithProvider,
  authLinkError,
  type OAuthProvider,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * Social sign-in shows once its provider is set up in Supabase (client ID and
 * secret) and switched on here, so there's never a button that can't work.
 */
const SOCIAL_PROVIDERS: { id: OAuthProvider; label: string; enabled: boolean }[] = [
  { id: 'google', label: 'Continue with Google', enabled: import.meta.env.VITE_GOOGLE_SIGN_IN === 'true' },
  { id: 'facebook', label: 'Continue with Facebook', enabled: import.meta.env.VITE_FACEBOOK_SIGN_IN === 'true' },
];

const EXPIRED_LINK = 'That link has expired or was already used. Enter your email to get a new one.';

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

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
  const [error, setError] = useState<string | null>(authLinkError ? EXPIRED_LINK : null);
  // "Forgot password?": ask for the email, send the reset link.
  const [resetting, setResetting] = useState(Boolean(authLinkError));
  const [resetSent, setResetSent] = useState(false);

  // An expired email link leaves #error=… in the address; tidy it once shown.
  useEffect(() => {
    if (authLinkError) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Enter the email you signed up with.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await sendPasswordReset(email.trim());
      setResetSent(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(
        /security purposes|rate limit|too many/i.test(msg)
          ? 'Please wait a minute before asking for another link.'
          : msg || "Couldn't send the link. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleProvider = async (provider: OAuthProvider) => {
    setLoading(true);
    setError(null);
    try {
      await signInWithProvider(provider); // leaves the page on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
      setLoading(false);
    }
  };

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
          <img src="/the-unsaved-mark.png" alt="" width={88} height={88} className="mb-1" />
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-4xl font-black tracking-tight text-gold sm:text-5xl">The</span>
            <span className="text-4xl font-black tracking-tight text-white sm:text-5xl">Unsaved</span>
          </div>
          <p className="text-sm text-ink-secondary">Turn reels into real life!</p>
        </div>

        {resetting ? (
          <div className="mt-8 rounded-card border border-gold/20 bg-surface p-5 sm:p-7">
            <h2 className="text-lg font-bold text-white">Reset your password</h2>
            <p className="mt-1 text-sm text-ink-secondary">We'll email you a link to set a new one.</p>
            {error && (
              <div role="alert" className="mt-5 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            )}
            {resetSent ? (
              <p role="status" className="mt-5 rounded-card border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
                If there's an account for {email.trim()}, a reset link is on its way. Check your inbox (and spam).
              </p>
            ) : (
              <form onSubmit={handleReset} className="mt-5 flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <div className="relative">
                    <Mail size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70" />
                    <Input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="pl-11"
                    />
                  </div>
                </div>
                <Button type="submit" size="lg" full disabled={loading} className="shadow-gold-glow">
                  {loading ? <><Loader2 className="animate-spin" /> Sending…</> : 'Send reset link'}
                </Button>
              </form>
            )}
            <Button
              variant="ghost"
              full
              className="mt-3"
              onClick={() => { setResetting(false); setResetSent(false); setError(null); }}
            >
              <ChevronLeft size={16} /> Back to sign in
            </Button>
          </div>
        ) : (
        <div className="mt-8 rounded-card border border-gold/20 bg-surface p-5 sm:p-7">
          <Tabs value={mode} onValueChange={(v) => switchMode(v as 'signin' | 'signup')}>
            {/* Full width at every size (the shared list shrinks to fit from sm up). */}
            <TabsList className="w-full sm:w-full">
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

          {SOCIAL_PROVIDERS.some((p) => p.enabled) && (
            <div className="mt-5 flex flex-col gap-3">
              {SOCIAL_PROVIDERS.filter((p) => p.enabled).map((p) => (
                <Button key={p.id} type="button" variant="outline" size="lg" full disabled={loading} onClick={() => handleProvider(p.id)}>
                  {p.id === 'google' && <GoogleMark />} {p.label}
                </Button>
              ))}
              <div className="flex items-center gap-3 text-xs text-ink-secondary">
                <span className="h-px flex-1 bg-gold/15" /> or with email <span className="h-px flex-1 bg-gold/15" />
              </div>
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
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => { setResetting(true); setError(null); }}
                  className="self-end text-xs font-medium text-gold underline-offset-2 hover:underline"
                >
                  Forgot password?
                </button>
              )}
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
        )}

        <p className="mt-6 text-center text-xs text-ink-secondary/60">
          Your saved venues are private to your account.
        </p>
      </div>
    </div>
  );
}

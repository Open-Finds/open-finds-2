import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, LogIn, UserPlus, User, AtSign, Check, X } from 'lucide-react';
import { signIn, signUp, upsertProfile, checkUsernameAvailable } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

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

  return (
    <div className="flex min-h-screen flex-col items-center justify-between bg-black px-6 py-12">
      {/* Top: logo + tagline */}
      <div className="flex w-full flex-col items-center pt-8 text-center">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-4xl font-black tracking-tight text-gold">Only</span>
          <span className="text-4xl font-black tracking-tight text-white">Finds</span>
        </div>
        <p className="text-sm text-ink-secondary">
          Discover venues. Build unforgettable nights.
        </p>
      </div>

      {/* Middle: form */}
      <div className="w-full">
        {/* Mode tabs */}
        <div className="mb-6 flex rounded-card border border-gold/20 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 rounded-[10px] py-2 text-sm font-semibold transition-all ${
              mode === 'signin'
                ? 'bg-gold text-black shadow-gold-glow'
                : 'text-ink-secondary hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 rounded-[10px] py-2 text-sm font-semibold transition-all ${
              mode === 'signup'
                ? 'bg-gold text-black shadow-gold-glow'
                : 'text-ink-secondary hover:text-white'
            }`}
          >
            Sign Up
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {mode === 'signup' && (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-ink-secondary">
                  Display Name
                </label>
                <div className="relative">
                  <User
                    size={17}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70"
                  />
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Robert Bui"
                    autoComplete="name"
                    className="w-full rounded-card border border-gold/20 bg-black/40 py-3.5 pl-11 pr-4 text-white placeholder:text-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-ink-secondary">
                  Username
                </label>
                <div className="relative">
                  <AtSign
                    size={17}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70"
                  />
                  <input
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
                          setUsernameAvailable(await checkUsernameAvailable(username.trim().replace(/^@/, '').toLowerCase()));
                        } catch { /* ignore */ }
                      }
                    }}
                    placeholder="e.g. robbui"
                    autoComplete="username"
                    className="w-full rounded-card border border-gold/20 bg-black/40 py-3.5 pl-11 pr-11 text-white placeholder:text-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
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
                  <p className="mt-1 text-xs text-danger">That username is taken.</p>
                )}
                {username.trim() && usernameAvailable === true && (
                  <p className="mt-1 text-xs text-success">Available!</p>
                )}
              </div>
            </>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-ink-secondary">
              Email
            </label>
            <div className="relative">
              <Mail
                size={17}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-card border border-gold/20 bg-black/40 py-3.5 pl-11 pr-4 text-white placeholder:text-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-ink-secondary">
              Password
            </label>
            <div className="relative">
              <Lock
                size={17}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70"
              />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full rounded-card border border-gold/20 bg-black/40 py-3.5 pl-11 pr-11 text-white placeholder:text-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-secondary transition-colors hover:text-gold"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-card bg-gold py-4 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              'Loading...'
            ) : mode === 'signin' ? (
              <><LogIn size={18} /> Sign In</>
            ) : (
              <><UserPlus size={18} /> Create Account</>
            )}
          </button>
        </form>

        {onBack && (
          <button
            onClick={onBack}
            className="mt-5 w-full text-center text-sm text-ink-secondary transition-colors hover:text-white"
          >
            Back
          </button>
        )}
      </div>

      {/* Bottom: fine print */}
      <p className="text-center text-xs text-ink-secondary/50">
        Your saved venues are private to your account.
      </p>
    </div>
  );
}

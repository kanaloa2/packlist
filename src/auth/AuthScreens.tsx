import { useState, type FormEvent, type ReactNode } from 'react';
import { appUrl, supabase } from '../supabase';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={48} height={48} />
          <h1>Packlist</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <Shell>
      <p className="muted center">Loading…</p>
    </Shell>
  );
}

type Mode = 'signin' | 'signup' | 'forgot';

export function AuthScreen({ notice }: { notice?: string }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(notice ?? '');

  function switchTo(m: Mode) {
    setMode(m);
    setError('');
    setInfo('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (!email.trim()) return setError('Enter your email address.');
    if (mode !== 'forgot' && password.length < 8) return setError('Passwords must be at least 8 characters.');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: appUrl() },
        });
        if (error) throw error;
        if (!data.session) {
          setMode('signin');
          setInfo(`Almost there — we sent a confirmation link to ${email.trim()}. Open it, then sign in here.`);
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
        if (error) throw error;
        setInfo(`If ${email.trim()} has an account, a reset link is on its way. Open it on this device to choose a new password.`);
      }
    } catch (err) {
      setError(friendly((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h2 className="auth-title">
        {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Reset your password'}
      </h2>
      <p className="muted center auth-sub">
        {mode === 'forgot'
          ? 'We’ll email you a link to choose a new password.'
          : 'Your trips and packing lists, on every device.'}
      </p>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        {mode !== 'forgot' && (
          <div className="field">
            <label className="label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'signup' && <p className="hint">At least 8 characters.</p>}
          </div>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="success" role="status">
            {info}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      <div className="auth-links">
        {mode === 'signin' && (
          <>
            <button className="link-btn" onClick={() => switchTo('forgot')}>
              Forgot password?
            </button>
            <span>
              New here?{' '}
              <button className="link-btn" onClick={() => switchTo('signup')}>
                Create an account
              </button>
            </span>
          </>
        )}
        {mode !== 'signin' && (
          <button className="link-btn" onClick={() => switchTo('signin')}>
            ← Back to sign in
          </button>
        )}
      </div>
    </Shell>
  );
}

export function SetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <h2 className="auth-title">Choose a new password</h2>
      <form
        className="form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (password.length < 8) return setError('Passwords must be at least 8 characters.');
          setBusy(true);
          const { error } = await supabase.auth.updateUser({ password });
          setBusy(false);
          if (error) setError(friendly(error.message));
          else onDone();
        }}
      >
        <div className="field">
          <label className="label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </Shell>
  );
}

export function ClaimScreen({
  trips,
  email,
  onKeep,
  onDiscard,
}: {
  trips: number;
  email: string;
  onKeep: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const what = trips ? `${trips} trip${trips === 1 ? '' : 's'}` : 'items';
  return (
    <Shell>
      <h2 className="auth-title">Keep what’s on this device?</h2>
      <p className="center">
        This device has {what} saved from before you signed in. Add {trips === 1 ? 'it' : 'them'} to{' '}
        <strong>{email}</strong> so {trips === 1 ? 'it’s' : 'they’re'} available everywhere?
      </p>
      <div className="form">
        <button
          className="btn btn-primary btn-block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onKeep();
          }}
        >
          Add to my account
        </button>
        <button
          className="btn btn-ghost btn-block"
          disabled={busy}
          onClick={async () => {
            if (!confirm(`Delete the ${what} on this device? This can’t be undone.`)) return;
            setBusy(true);
            await onDiscard();
          }}
        >
          Discard them
        </button>
      </div>
    </Shell>
  );
}

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match an account.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first — check your inbox for the link.';
  if (/already registered|already exists/i.test(message)) return 'An account with that email already exists. Try signing in.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/failed to fetch|network/i.test(message)) return 'Can’t reach the server. Check your connection and try again.';
  return message;
}

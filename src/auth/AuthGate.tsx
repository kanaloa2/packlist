import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { clearLocalData, hasLocalData, localOwner, localTripCount, setLocalOwner, sync } from '../sync';
import { AuthScreen, ClaimScreen, SetPasswordScreen, Splash } from './AuthScreens';

interface AuthContextValue {
  session: Session;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthGate>');
  return ctx;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'signedOut'; notice?: string }
  | { kind: 'recovery'; session: Session }
  | { kind: 'claim'; session: Session; trips: number }
  | { kind: 'ready'; session: Session };

/**
 * Shows the sign-in screen until there's a session, makes sure this device's local copy
 * belongs to the signed-in user, then starts sync and renders the app.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhaseState] = useState<Phase>({ kind: 'loading' });
  const phaseRef = useRef<Phase>(phase);
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const preparedFor = useRef<string | null>(null);
  const hadCode = useRef(new URLSearchParams(window.location.search).has('code'));

  async function prepare(session: Session) {
    const uid = session.user.id;
    if (preparedFor.current === uid) return;
    preparedFor.current = uid;
    const owner = await localOwner();
    if (owner && owner !== uid) {
      // Another account's copy is on this device. It's safe on the server; drop it here.
      await clearLocalData();
    } else if (!owner && (await hasLocalData())) {
      // Data from before accounts existed: let the user decide whether to keep it.
      setPhase({ kind: 'claim', session, trips: await localTripCount() });
      return;
    }
    await setLocalOwner(uid);
    void sync.start(uid);
    setPhase({ kind: 'ready', session });
  }

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      // Supabase calls back synchronously inside its own lock; defer our async work.
      setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY' && session) {
          setPhase({ kind: 'recovery', session });
        } else if (event === 'SIGNED_OUT' || !session) {
          preparedFor.current = null;
          if (phaseRef.current.kind !== 'signedOut') setPhase({ kind: 'signedOut' });
        } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          if (phaseRef.current.kind !== 'recovery') void prepare(session);
        }
      }, 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      // Tidy the ?code=… left by an email link.
      if (hadCode.current) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
      if (!data.session) {
        setPhase({
          kind: 'signedOut',
          notice: hadCode.current
            ? 'If you just confirmed your email, sign in below. (Email links only sign you in automatically on the device where you created the account.)'
            : undefined,
        });
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await sync.syncNow();
    const pending = sync.getStatus().pending;
    if (
      pending > 0 &&
      !confirm(
        `${pending} change${pending === 1 ? " hasn't" : "s haven't"} reached the server yet (you may be offline). Signing out now will lose ${pending === 1 ? 'it' : 'them'}. Sign out anyway?`,
      )
    ) {
      return;
    }
    await sync.stop();
    await clearLocalData();
    preparedFor.current = null;
    await supabase.auth.signOut();
    setPhase({ kind: 'signedOut' });
  }

  switch (phase.kind) {
    case 'loading':
      return <Splash />;
    case 'signedOut':
      return <AuthScreen notice={phase.notice} />;
    case 'recovery':
      return (
        <SetPasswordScreen
          onDone={() => {
            preparedFor.current = null;
            void prepare(phase.session);
          }}
        />
      );
    case 'claim':
      return (
        <ClaimScreen
          trips={phase.trips}
          email={phase.session.user.email ?? ''}
          onKeep={async () => {
            const uid = phase.session.user.id;
            // Queue the upload BEFORE sync starts: a pull with an empty queue would make
            // this device match the (empty) server and erase the data we're keeping.
            await sync.enqueueAll();
            await setLocalOwner(uid);
            void sync.start(uid);
            setPhase({ kind: 'ready', session: phase.session });
          }}
          onDiscard={async () => {
            await clearLocalData();
            preparedFor.current = null;
            await prepare(phase.session);
          }}
        />
      );
    case 'ready':
      return <AuthContext.Provider value={{ session: phase.session, signOut }}>{children}</AuthContext.Provider>;
  }
}

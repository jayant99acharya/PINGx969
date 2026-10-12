import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth';
import { ErrorBox } from '../ui';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register, expired } = useAuth();
  const [params] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = params.get('next') || '/';
  // After sign-in/registration the user state flips and this redirect takes over.
  if (user) return <Navigate to={mode === 'register' ? '/resumes?welcome=1' : next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="row" style={{ marginBottom: 18 }}>
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <div>
            <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
            <p className="muted">Tailor your resume honestly. Apply faster.</p>
          </div>
        </div>
        {expired && mode === 'login' && <div className="alert alert-warn" style={{ marginBottom: 12 }}>Your session expired. Please sign in again.</div>}
        <form className="stack" onSubmit={submit} noValidate>
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 10 : 1} />
            {mode === 'register' && <span className="help">At least 10 characters.</span>}
          </div>
          <ErrorBox error={error} />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16, textAlign: 'center' }}>
          {mode === 'login' ? (
            <>
              New here? <Link to="/register">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to="/login">Sign in</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

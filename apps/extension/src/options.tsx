import { StrictMode, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { bg, type Bootstrap } from './messages';

interface AuthStatus {
  signedIn: boolean;
  email?: string;
  name?: string;
  apiUrl: string;
  expired?: boolean;
  offline?: boolean;
  error?: string;
}

function Options() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [apiUrl, setApiUrl] = useState('http://localhost:4000');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Bootstrap['settings'] | null>(null);
  const [allSites, setAllSites] = useState(false);

  const refresh = async () => {
    const a = await bg<AuthStatus>({ type: 'auth/status' }).catch((e: Error): AuthStatus => ({ signedIn: false, apiUrl: 'http://localhost:4000', error: e.message }));
    setAuth(a);
    if (a.apiUrl) setApiUrl(a.apiUrl);
    if (a.email) setEmail(a.email);
    if (a.signedIn) setSettings((await bg<Bootstrap>({ type: 'data/bootstrap', force: true }).catch(() => null))?.settings ?? null);
    setAllSites(await chrome.permissions.contains({ origins: ['https://*/*'] }));
  };
  useEffect(() => {
    void refresh();
  }, []);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const origin = new URL(apiUrl).origin;
      const local = /^(localhost|127\.0\.0\.1)$/.test(new URL(apiUrl).hostname);
      if (!local) {
        const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
        if (!ok) throw new Error('Permission to contact the server was not granted.');
      }
      await bg({ type: 'auth/login', apiUrl, email, password });
      setPassword('');
      setInfo('Signed in. Open any job application to autofill it.');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    await bg({ type: 'auth/logout' });
    setSettings(null);
    await refresh();
  };
  const toggle = async (k: keyof Bootstrap['settings'], v: boolean) => {
    try {
      await bg({ type: 'settings/update', patch: { [k]: v } });
      setSettings((s) => (s ? { ...s, [k]: v } : s));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const enableAll = async () => {
    setError('');
    const ok = await chrome.permissions.request({ origins: ['https://*/*'] });
    if (!ok) return setError('Permission not granted. You can still use “Scan this page” from the toolbar on any site.');
    await bg({ type: 'permissions/enableAllSites' }).catch((e: Error) => setError(e.message));
    setAllSites(true);
  };

  return (
    <main className="options">
      <h1>⚡ PINGx969 — Settings</h1>
      {!auth ? (
        <p>Loading…</p>
      ) : auth.signedIn ? (
        <section className="card">
          <h2>Account</h2>
          <p>
            Signed in as <strong>{auth.email}</strong> on <code>{auth.apiUrl}</code>
          </p>
          {auth.offline && <div className="alert warn">{auth.error}</div>}
          <div className="row">
            <button className="btn" onClick={() => void bg({ type: 'open/dashboard', path: '/' })}>
              Open dashboard
            </button>
            <button className="btn" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        </section>
      ) : (
        <form className="card" onSubmit={login}>
          <h2>Sign in</h2>
          {auth.expired && <div className="alert warn">Your session expired. Please sign in again.</div>}
          <label>
            Server URL
            <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} required />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <p className="muted small">Your password is sent only to your PINGx969 server and never stored by the extension. The extension keeps a revocable 30-day token.</p>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}
      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert good">{info}</div>}
      {settings && (
        <section className="card">
          <h2>Autofill</h2>
          <label className="check">
            <input type="checkbox" checked={settings.autoLearn} onChange={(e) => void toggle('autoLearn', e.target.checked)} /> Learn answers I type on application forms
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.showLauncher} onChange={(e) => void toggle('showLauncher', e.target.checked)} /> Show the Autofill button on application pages
          </label>
        </section>
      )}
      <section className="card">
        <h2>Where it runs</h2>
        <p className="muted small">
          By default PINGx969 runs automatically only on known applicant-tracking sites (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, Workable, iCIMS, Jobvite, BambooHR). On any other site, click the toolbar icon and choose “Scan this page” — that grants one-time access to that tab only.
        </p>
        {allSites ? (
          <p>✓ Enabled on all https sites.</p>
        ) : (
          <button className="btn" onClick={() => void enableAll()}>
            Enable on all websites (optional)
          </button>
        )}
      </section>
      <section className="card">
        <h2>Privacy</h2>
        <ul className="small">
          <li>Your profile and saved answers are fetched from your server when needed and kept only in memory (cleared when the browser closes).</li>
          <li>The extension never stores job-site passwords and never submits applications.</li>
          <li>Fields that already contain a value are not overwritten unless you choose to replace them.</li>
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);

import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import { Icon } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/resumes', label: 'Resumes', icon: 'file' },
  { to: '/optimize', label: 'Optimize', icon: 'spark' },
  { to: '/applications', label: 'Applications', icon: 'briefcase' },
  { to: '/profile', label: 'Profile', icon: 'user' },
  { to: '/answers', label: 'Saved answers', icon: 'chat' },
  { to: '/extension', label: 'Browser extension', icon: 'puzzle' },
  { to: '/settings', label: 'Settings', icon: 'gear' },
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('px-theme') ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);
  const toggle = () => {
    const isDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('px-theme', next);
    } catch {
      /* storage unavailable */
    }
  };
  return [theme, toggle];
}

export function Layout() {
  const { user, logout } = useAuth();
  const [, toggleTheme] = useTheme();
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <NavLink to="/" className="brand" aria-label="PINGx969 home">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          PINGx969
        </NavLink>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span title={user?.email}>{user?.displayName || user?.email}</span>
          <div className="row">
            <button className="btn btn-sm btn-ghost" onClick={toggleTheme} aria-label="Toggle light/dark theme">
              <Icon name="sun" /> Theme
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void logout()}>
              <Icon name="logout" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

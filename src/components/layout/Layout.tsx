import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useData } from '../../context/DataContext';
import { breadcrumb } from '../../lib/nav';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import Logo from '../ui/Logo';
import Sidebar from './Sidebar';

export default function Layout() {
  const { role, user, coordinator, signOut } = useData();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const name = coordinator?.name ?? user?.name ?? '';

  useEffect(() => setMenu(false), [pathname]); // the phone menu closes when you pick a page

  return (
    <div className="flex h-screen">
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line bg-white px-4" style={{ height: 'var(--topbar-height)' }}>
          <button aria-label="Menu" className="mr-2 rounded p-1 text-ink-2 hover:bg-page md:hidden" onClick={() => setMenu(true)}>
            <Icon name="menu" />
          </button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-ink-2">
            {role && breadcrumb(role, pathname).map((crumb, i, all) => (
              <span key={crumb} className={i === all.length - 1 ? 'font-medium text-ink' : ''}>
                {i > 0 && <span className="mr-1.5 text-ink-3">›</span>}
                {crumb}
              </span>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Logo className="h-6" />
            <span title={name}><Avatar name={name} color={coordinator?.color} size="sm" /></span>
            <button title="Sign out" onClick={signOut} className="rounded p-1 text-ink-2 transition hover:bg-page hover:text-primary">
              <Icon name="logout" />
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6" style={{ background: 'var(--bg-page)' }}>
          <Suspense fallback={<p role="status" className="animate-pulse text-ink-2">Loading…</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

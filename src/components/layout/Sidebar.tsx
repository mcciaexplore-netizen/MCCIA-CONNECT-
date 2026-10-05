import { NavLink, useLocation, useNavigate } from 'react-router';
import { useData } from '../../context/DataContext';
import { activeSection, NAV } from '../../lib/nav';
import { cn } from '../../lib/utils';
import Icon from '../ui/Icon';

interface Props {
  open: boolean; // the menu is showing (only matters below 768px; wider screens always show it)
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: Props) {
  const { role, signOut } = useData();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!role) return null;

  const active = activeSection(role, pathname);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={onClose} />}
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex shrink-0 transition-transform md:static md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        {/* icon bar: one icon per section */}
        <div className="flex flex-col items-center gap-1 py-2" style={{ width: 'var(--sidebar-width)', background: 'var(--bg-sidebar)' }}>
          {NAV[role].map((section) => (
            <button
              key={section.title}
              title={section.title}
              onClick={() => navigate(section.items[0].to)}
              className={cn('flex h-8 w-8 items-center justify-center rounded-full transition', section === active ? 'text-white' : 'text-white/70 hover:bg-white/10 hover:text-white')}
              style={section === active ? { background: 'var(--bg-sidebar-active)' } : undefined}
            >
              <Icon name={section.icon} />
            </button>
          ))}
          <button title="Sign out" onClick={signOut} className="mt-auto flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white">
            <Icon name="logout" />
          </button>
        </div>

        {/* nav panel: the active section's pages */}
        <nav className="flex flex-col border-r border-line bg-white" style={{ width: 'var(--nav-width)' }}>
          <h2 className="flex items-center border-b border-line px-4 text-xs font-semibold uppercase tracking-wide text-ink-2" style={{ height: 'var(--topbar-height)' }}>
            {active.title}
          </h2>
          <ul className="py-2">
            {active.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn('block border-l-[3px] px-4 py-2 text-[13px]', isActive ? 'border-primary bg-primary-light font-medium text-primary' : 'border-transparent text-ink hover:bg-page')
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </>
  );
}

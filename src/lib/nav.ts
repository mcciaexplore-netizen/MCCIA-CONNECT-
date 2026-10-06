import type { IconName } from '../components/ui/Icon';
import type { Role } from '../types';

export interface NavSection {
  title: string;
  icon: IconName;
  items: { to: string; label: string }[];
}

// The icon bar shows the sections; the nav panel next to it lists the active section's pages.
export const NAV: Record<Role, NavSection[]> = {
  super_admin: [
    { title: 'Dashboard', icon: 'grid', items: [{ to: '/admin/dashboard', label: 'Dashboard' }] },
    {
      title: 'Tickets',
      icon: 'ticket',
      items: [
        { to: '/admin/tickets', label: 'Tickets' },
        { to: '/admin/create-booking', label: 'Create booking' },
      ],
    },
    {
      title: 'Clients',
      icon: 'users',
      items: [
        { to: '/admin/clients', label: 'Clients' },
        { to: '/admin/companies', label: 'Companies' },
      ],
    },
    { title: 'Team', icon: 'user-group', items: [{ to: '/admin/coordinators', label: 'Coordinators' }] },
    {
      title: 'Settings',
      icon: 'settings',
      items: [
        { to: '/admin/form-builder', label: 'Form builder' },
        { to: '/admin/slot-manager', label: 'Slot manager' },
        { to: '/admin/audit-logs', label: 'Audit logs' },
        { to: '/admin/settings', label: 'Settings' },
      ],
    },
  ],
  coordinator: [
    { title: 'Dashboard', icon: 'grid', items: [{ to: '/coordinator/dashboard', label: 'Dashboard' }] },
    {
      title: 'Tickets',
      icon: 'ticket',
      items: [
        { to: '/coordinator/tickets', label: 'My tickets' },
        { to: '/coordinator/create-booking', label: 'Create booking' },
      ],
    },
    {
      title: 'Schedule',
      icon: 'calendar',
      items: [
        { to: '/coordinator/schedule', label: 'My schedule' },
        { to: '/coordinator/slots', label: 'My slots' },
      ],
    },
    { title: 'Clients', icon: 'users', items: [{ to: '/coordinator/clients', label: 'My clients' }] },
    { title: 'Account', icon: 'settings', items: [{ to: '/coordinator/account', label: 'Change password' }] },
  ],
};

export function activeSection(role: Role, pathname: string) {
  return NAV[role].find((section) => section.items.some((item) => pathname.startsWith(item.to))) ?? NAV[role][0];
}

/** e.g. ["Tickets", "My tickets", "Details"] for /coordinator/tickets/123. */
export function breadcrumb(role: Role, pathname: string) {
  const section = activeSection(role, pathname);
  const item = section.items.find((i) => pathname.startsWith(i.to));
  return [...new Set([section.title, ...(item ? [item.label] : [])])].concat(item && pathname !== item.to ? ['Details'] : []);
}

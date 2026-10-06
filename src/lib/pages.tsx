import { lazy, type ComponentProps, type ComponentType } from 'react';

/**
 * The staff screens are each their own download (the charts library is the big one), fetched when first needed, so the first
 * download stays small. A screen whose file has already arrived draws at once; only a screen that has not arrived yet shows the
 * loading placeholder (which React then holds for 300 ms to avoid flicker). Preloading makes that rare: the screen for the address
 * starts downloading when the app starts, and after sign-in the rest are fetched quietly in the background.
 * The public pages (booking, confirmation, feedback, login) are not in this list: they are in the first download, so clients never wait.
 */
const loaded = new Map<string, ComponentType<never>>();

function screen<P extends object>(name: string, load: () => Promise<{ default: ComponentType<P> }>) {
  const Lazy = lazy(load);
  const warm = () => load().then((module) => void loaded.set(name, module.default as ComponentType<never>), () => {});
  const Screen = (props: P) => {
    const Ready = loaded.get(name) as unknown as ComponentType<P> | undefined;
    return Ready ? <Ready {...props} /> : <Lazy {...(props as ComponentProps<typeof Lazy>)} />;
  };
  return { Screen, warm };
}

const s = {
  Dashboard: screen('Dashboard', () => import('../pages/admin/Dashboard')),
  Tickets: screen('Tickets', () => import('../pages/admin/Tickets')),
  TicketDetail: screen('TicketDetail', () => import('../pages/admin/TicketDetail')),
  Clients: screen('Clients', () => import('../pages/admin/Clients')),
  ClientProfile: screen('ClientProfile', () => import('../pages/admin/ClientProfile')),
  Coordinators: screen('Coordinators', () => import('../pages/admin/Coordinators')),
  CreateBooking: screen('CreateBooking', () => import('../pages/admin/CreateBooking')),
  FormBuilder: screen('FormBuilder', () => import('../pages/admin/FormBuilder')),
  SlotManager: screen('SlotManager', () => import('../pages/admin/SlotManager')),
  AuditLogs: screen('AuditLogs', () => import('../pages/admin/AuditLogs')),
  Settings: screen('Settings', () => import('../pages/admin/Settings')),
  MyDashboard: screen('MyDashboard', () => import('../pages/coordinator/MyDashboard')),
  MyTickets: screen('MyTickets', () => import('../pages/coordinator/MyTickets')),
  MyClients: screen('MyClients', () => import('../pages/coordinator/MyClients')),
  MySchedule: screen('MySchedule', () => import('../pages/coordinator/MySchedule')),
  MyAccount: screen('MyAccount', () => import('../pages/coordinator/MyAccount')),
  MonthlyBookings: screen('MonthlyBookings', () => import('../components/client/MonthlyBookings')),
};

export const Dashboard = s.Dashboard.Screen;
export const Tickets = s.Tickets.Screen;
export const TicketDetail = s.TicketDetail.Screen;
export const Clients = s.Clients.Screen;
export const ClientProfile = s.ClientProfile.Screen;
export const Coordinators = s.Coordinators.Screen;
export const CreateBooking = s.CreateBooking.Screen;
export const FormBuilder = s.FormBuilder.Screen;
export const SlotManager = s.SlotManager.Screen;
export const AuditLogs = s.AuditLogs.Screen;
export const Settings = s.Settings.Screen;
export const MyDashboard = s.MyDashboard.Screen;
export const MyTickets = s.MyTickets.Screen;
export const MyClients = s.MyClients.Screen;
export const MySchedule = s.MySchedule.Screen;
export const MyAccount = s.MyAccount.Screen;
export const MonthlyBookings = s.MonthlyBookings.Screen;

type Name = keyof typeof s;

// The screen for an address starts downloading the moment the app starts, in parallel with finding out who is signed in.
// The front pages also warm up both dashboards (small), so signing in is instant.
const ROUTES: [RegExp, Name[]][] = [
  [/^\/(login)?$/, ['Dashboard', 'MyDashboard']],
  [/^\/admin\/dashboard/, ['Dashboard']],
  [/^\/admin\/tickets\/./, ['TicketDetail']],
  [/^\/admin\/tickets/, ['Tickets']],
  [/^\/admin\/clients\/./, ['ClientProfile']],
  [/^\/admin\/clients/, ['Clients']],
  [/^\/admin\/coordinators/, ['Coordinators']],
  [/^\/admin\/create-booking/, ['CreateBooking']],
  [/^\/admin\/form-builder/, ['FormBuilder']],
  [/^\/admin\/slot-manager/, ['SlotManager']],
  [/^\/admin\/audit-logs/, ['AuditLogs']],
  [/^\/admin\/settings/, ['Settings']],
  [/^\/coordinator\/dashboard/, ['MyDashboard']],
  [/^\/coordinator\/tickets\/./, ['TicketDetail']],
  [/^\/coordinator\/tickets/, ['MyTickets']],
  [/^\/coordinator\/clients\/./, ['ClientProfile']],
  [/^\/coordinator\/clients/, ['MyClients']],
  [/^\/coordinator\/schedule/, ['MySchedule']],
  [/^\/coordinator\/account/, ['MyAccount']],
];
export function preloadRoute(pathname: string) {
  ROUTES.find(([pattern]) => pattern.test(pathname))?.[1].forEach((name) => void s[name].warm());
}

const GROUPS: Record<'super_admin' | 'coordinator', Name[]> = {
  super_admin: ['Dashboard', 'Tickets', 'TicketDetail', 'Clients', 'ClientProfile', 'Coordinators', 'CreateBooking', 'Settings', 'FormBuilder', 'SlotManager', 'AuditLogs'],
  coordinator: ['MyDashboard', 'MyTickets', 'TicketDetail', 'MyClients', 'ClientProfile', 'MySchedule', 'MyAccount'],
};

/**
 * Fetches a person's screens one by one while the browser is idle (nothing they are doing waits for it), starting a moment after
 * the first screen has settled so the quiet downloads never compete with drawing it. The charts library is the one big piece
 * and is never preloaded: it comes with the client profile that uses it.
 */
export function preload(group: keyof typeof GROUPS) {
  const queue = [...GROUPS[group]];
  const next = () => {
    const name = queue.shift();
    if (name) s[name].warm().then(() => idle(next));
  };
  setTimeout(() => idle(next), 1500);
}
const idle = (run: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));

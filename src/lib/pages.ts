import { lazy } from 'react';

/**
 * Every screen is its own download, fetched the first time it is needed, so a client booking a session never downloads the
 * staff screens (or the charts library). After sign-in the staff screens are fetched quietly in the background (preload),
 * so moving around still feels instant.
 */
const load = {
  Landing: () => import('../pages/public/Landing'),
  BookingPage: () => import('../pages/public/BookingPage'),
  ConfirmationPage: () => import('../pages/public/ConfirmationPage'),
  FeedbackPage: () => import('../pages/public/FeedbackPage'),
  Login: () => import('../pages/Login'),
  Dashboard: () => import('../pages/admin/Dashboard'),
  Tickets: () => import('../pages/admin/Tickets'),
  TicketDetail: () => import('../pages/admin/TicketDetail'),
  Clients: () => import('../pages/admin/Clients'),
  ClientProfile: () => import('../pages/admin/ClientProfile'),
  Coordinators: () => import('../pages/admin/Coordinators'),
  CreateBooking: () => import('../pages/admin/CreateBooking'),
  FormBuilder: () => import('../pages/admin/FormBuilder'),
  SlotManager: () => import('../pages/admin/SlotManager'),
  AuditLogs: () => import('../pages/admin/AuditLogs'),
  Settings: () => import('../pages/admin/Settings'),
  MyDashboard: () => import('../pages/coordinator/MyDashboard'),
  MyTickets: () => import('../pages/coordinator/MyTickets'),
  MyClients: () => import('../pages/coordinator/MyClients'),
  MySchedule: () => import('../pages/coordinator/MySchedule'),
  MyAccount: () => import('../pages/coordinator/MyAccount'),
  MonthlyBookings: () => import('../components/client/MonthlyBookings'),
};

export const Landing = lazy(load.Landing);
export const BookingPage = lazy(load.BookingPage);
export const ConfirmationPage = lazy(load.ConfirmationPage);
export const FeedbackPage = lazy(load.FeedbackPage);
export const Login = lazy(load.Login);
export const Dashboard = lazy(load.Dashboard);
export const Tickets = lazy(load.Tickets);
export const TicketDetail = lazy(load.TicketDetail);
export const Clients = lazy(load.Clients);
export const ClientProfile = lazy(load.ClientProfile);
export const Coordinators = lazy(load.Coordinators);
export const CreateBooking = lazy(load.CreateBooking);
export const FormBuilder = lazy(load.FormBuilder);
export const SlotManager = lazy(load.SlotManager);
export const AuditLogs = lazy(load.AuditLogs);
export const Settings = lazy(load.Settings);
export const MyDashboard = lazy(load.MyDashboard);
export const MyTickets = lazy(load.MyTickets);
export const MyClients = lazy(load.MyClients);
export const MySchedule = lazy(load.MySchedule);
export const MyAccount = lazy(load.MyAccount);
export const MonthlyBookings = lazy(load.MonthlyBookings);

// The screen for an address starts downloading the moment the app starts, in parallel with finding out who is signed in,
// instead of only after that answer arrives. The front pages also warm up both dashboards (small), so signing in is instant.
const ROUTES: [RegExp, (keyof typeof load)[]][] = [
  [/^\/$/, ['Landing', 'Dashboard', 'MyDashboard']],
  [/^\/login/, ['Login', 'Dashboard', 'MyDashboard']],
  [/^\/book\//, ['BookingPage']],
  [/^\/confirmed\//, ['ConfirmationPage']],
  [/^\/feedback\//, ['FeedbackPage']],
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
  ROUTES.find(([pattern]) => pattern.test(pathname))?.[1].forEach((name) => void load[name]().catch(() => {}));
}

const GROUPS = {
  public: [load.BookingPage, load.ConfirmationPage, load.FeedbackPage, load.Login],
  super_admin: [load.Dashboard, load.Tickets, load.TicketDetail, load.Clients, load.ClientProfile, load.MonthlyBookings, load.Coordinators, load.CreateBooking, load.Settings, load.FormBuilder, load.SlotManager, load.AuditLogs],
  coordinator: [load.MyDashboard, load.MyTickets, load.TicketDetail, load.MyClients, load.ClientProfile, load.MonthlyBookings, load.MySchedule, load.MyAccount],
} as const;

/** Fetches a group of screens one by one while the browser is idle (nothing the person is doing waits for it). */
export function preload(group: keyof typeof GROUPS) {
  const queue = [...GROUPS[group]];
  const next = () => {
    const step = queue.shift();
    if (step) step().then(() => idle(next), () => {});
  };
  idle(next);
}
const idle = (run: () => void) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 200));

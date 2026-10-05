import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { api, ApiError, errorMessage } from '../lib/utils';
import { DEFAULT_SETTINGS, type AppSettings, type AuditLog, type Booking, type Client, type Coordinator, type Module, type Role, type Session, type SlotConfig, type Ticket } from '../types';

/** Loaded for everyone as soon as they sign in. */
interface Base {
  modules: Module[];
  coordinators: Coordinator[]; // admins get everyone, a coordinator only themselves
  settings: AppSettings; // admin only (defaults for coordinators)
}

/** Loaded per page: a page asks for what it shows (usePageData) and it is kept up to date from then on. */
interface Records {
  tickets: Ticket[];
  clients: Client[];
  bookings: Booking[];
  slotConfigs: SlotConfig[]; // admin only
  auditLogs: AuditLog[]; // admin only
}

const RECORD_PATHS: Record<keyof Records, string> = { tickets: '/api/tickets', clients: '/api/clients', bookings: '/api/bookings', slotConfigs: '/api/slots', auditLogs: '/api/audit-logs' };
export type Slice = keyof Records;

const EMPTY_BASE: Base = { modules: [], coordinators: [], settings: DEFAULT_SETTINGS };
const NONE: never[] = []; // one shared empty list, so an unloaded slice does not look like a change on every render

/** Who is signed in, as GET /api/auth/me returns it (read from the session cookie on the server). */
export interface Me {
  userId: string;
  role: Role;
  coordinatorId: string | null;
  name: string;
  email: string;
}

interface DataContextValue extends Base, Records {
  // auth
  authLoading: boolean;
  user: Me | null;
  role: Role | null;
  coordinator: Coordinator | null; // the signed-in coordinator's own record (null for admins)
  base: '/admin' | '/coordinator';
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  // data
  sessions: Session[];
  getClient: (id: string) => Client | undefined;
  getModule: (id: string) => Module | undefined;
  getCoordinator: (id: string | null) => Coordinator | undefined;
  getSession: (ticketId: string) => Session | undefined;
  /** Reloads the base data and every slice a page has asked for (also what "Retry" calls). */
  refresh: () => Promise<void>;
  /** Authenticated GET for data that is not part of the shared state (e.g. one client's coordinator history). */
  get: <T = unknown>(path: string) => Promise<T>;
  /** Calls a write endpoint, toasts the outcome, reloads data. Resolves to null when it failed. */
  mutate: <T = unknown>(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown, success?: string) => Promise<T | null>;
  /** Downloads an Excel file, generated fresh: every module's tab, just the given tickets, or (audit) the audit log. */
  exportExcel: (options?: { ids?: string[]; audit?: boolean }) => Promise<void>;
  // used by usePageData
  want: (slices: Slice[]) => void;
  ready: Slice[];
  baseReady: boolean;
  error: string;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside DataProvider');
  return value;
}

/**
 * Asks for the slices of data a page shows and says where loading stands: { loading, error, retry }.
 * Nothing but modules, coordinators and settings is loaded up front, so a page that needs tickets calls usePageData('tickets').
 */
export function usePageData(...slices: Slice[]) {
  const { want, ready, baseReady, error, refresh } = useData();
  const wanted = slices.join();
  useEffect(() => want(slices), [wanted, want]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = !baseReady || slices.some((slice) => !ready.includes(slice));
  return { loading: missing && !error, error: missing ? error : '', retry: refresh };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [base, setBase] = useState<Base>(EMPTY_BASE);
  const [baseReady, setBaseReady] = useState(false);
  const [records, setRecords] = useState<Partial<Records>>({});
  const [error, setError] = useState('');
  const wanted = useRef(new Set<Slice>());
  // The latest state for the loaders below, which must not change identity every time data arrives.
  const loaded = useRef({ baseReady, records });
  loaded.current = { baseReady, records };

  const role = user?.role ?? null;

  // ---------- auth ----------
  // The session is an httpOnly cookie, so the browser asks the server who it belongs to.
  useEffect(() => {
    api<Me>('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const clearData = useCallback(() => {
    wanted.current.clear();
    setBase(EMPTY_BASE);
    setBaseReady(false);
    setRecords({});
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser(await api<Me>('/api/auth/login', { method: 'POST', body: { email, password } }));
  }, []);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    clearData();
  }, [clearData]);

  // A request the server refuses with 401 means the session ended (expired, or the account was deactivated).
  const sessionEnded = useCallback(
    (e: unknown) => {
      if (!(e instanceof ApiError) || e.status !== 401) return false;
      setUser(null);
      clearData();
      toast.error('Your session ended. Please sign in again.');
      return true;
    },
    [clearData],
  );

  // ---------- data ----------
  // A first load that fails becomes the page's error state (with Retry); a failed reload of data already on screen is just a toast.
  const fail = useCallback(
    (e: unknown, hadData: boolean) => {
      if (sessionEnded(e)) return;
      if (hadData) toast.error(errorMessage(e));
      else setError(errorMessage(e));
    },
    [sessionEnded],
  );

  const loadBase = useCallback(async () => {
    if (!role) return;
    const get = <T,>(path: string) => api<T>(path);
    try {
      const [modules, coordinators, settings] = await Promise.all([
        get<Module[]>('/api/modules'),
        get<Coordinator[]>('/api/coordinators'),
        role === 'admin' ? get<AppSettings>('/api/settings') : DEFAULT_SETTINGS,
      ]);
      setBase({ modules, coordinators, settings });
      setBaseReady(true);
    } catch (e) {
      fail(e, loaded.current.baseReady);
    }
  }, [role, fail]);

  const loadSlices = useCallback(
    async (slices: Slice[]) => {
      if (!role || !slices.length) return;
      try {
        const rows = await Promise.all(slices.map((slice) => api<unknown[]>(RECORD_PATHS[slice])));
        setRecords((current) => ({ ...current, ...Object.fromEntries(slices.map((slice, i) => [slice, rows[i]])) }));
      } catch (e) {
        fail(e, slices.every((slice) => slice in loaded.current.records));
      }
    },
    [role, fail],
  );

  const refresh = useCallback(async () => {
    setError('');
    await Promise.all([loadBase(), loadSlices([...wanted.current])]);
  }, [loadBase, loadSlices]);

  const want = useCallback(
    (slices: Slice[]) => {
      const fresh = slices.filter((slice) => !wanted.current.has(slice));
      fresh.forEach((slice) => wanted.current.add(slice));
      loadSlices(fresh);
    },
    [loadSlices],
  );

  // Load the base data on sign-in (pages ask for the rest with usePageData).
  useEffect(() => {
    if (role) loadBase();
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const get = useCallback(<T,>(path: string) => api<T>(path), []);

  const mutate: DataContextValue['mutate'] = useCallback(
    async (path, method, body, success) => {
      try {
        const result = await api(path, { method, body });
        if (success) toast.success(success);
        await refresh();
        return result as never;
      } catch (e) {
        if (!sessionEnded(e)) toast.error(errorMessage(e));
        return null;
      }
    },
    [refresh, sessionEnded],
  );

  const exportExcel: DataContextValue['exportExcel'] = useCallback(async ({ ids, audit } = {}) => {
    try {
      const query = audit ? 'audit=1' : `modules=all${ids ? `&ids=${ids.join(',')}` : ''}`;
      const file = await api<Blob>(`/api/excel/download?${query}`, { blob: true });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = `MCCIA-${audit ? 'Audit-Logs' : 'Bookings'}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
      toast.success(audit ? 'Audit log downloaded' : 'Excel downloaded');
    } catch (e) {
      if (!sessionEnded(e)) toast.error(errorMessage(e));
    }
  }, [sessionEnded]);

  // ---------- lookups ----------
  const tickets = records.tickets ?? NONE;
  const clients = records.clients ?? NONE;
  const bookings = records.bookings ?? NONE;
  const maps = useMemo(() => {
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
    const ticketByBooking = new Map(tickets.map((ticket) => [ticket.bookingId, ticket]));

    const sessions = bookings
      .flatMap((booking) => {
        const ticket = ticketByBooking.get(booking.id);
        return ticket ? [{ booking, ticket }] : [];
      })
      .sort((a, b) => a.booking.startTime.localeCompare(b.booking.startTime));

    return { clients: byId(clients), modules: byId(base.modules), coordinators: byId(base.coordinators), sessions, byTicket: new Map(sessions.map((s) => [s.ticket.id, s])) };
  }, [tickets, clients, bookings, base.modules, base.coordinators]);

  const value: DataContextValue = {
    ...base,
    tickets,
    clients,
    bookings,
    slotConfigs: records.slotConfigs ?? NONE,
    auditLogs: records.auditLogs ?? NONE,
    authLoading,
    user,
    role,
    coordinator: role === 'coordinator' ? (base.coordinators[0] ?? null) : null,
    base: role === 'coordinator' ? '/coordinator' : '/admin',
    signIn,
    signOut,
    sessions: maps.sessions,
    getClient: (id) => maps.clients.get(id),
    getModule: (id) => maps.modules.get(id),
    getCoordinator: (id) => (id ? maps.coordinators.get(id) : undefined),
    getSession: (ticketId) => maps.byTicket.get(ticketId),
    refresh,
    get,
    mutate,
    exportExcel,
    want,
    ready: Object.keys(records) as Slice[],
    baseReady,
    error,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

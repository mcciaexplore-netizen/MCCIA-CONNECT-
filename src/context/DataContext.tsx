import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { api, ApiError, errorMessage, setStudioZone } from '../lib/utils';
import { DEFAULT_SETTINGS, type AdminNotification, type AppSettings, type Booking, type Client, type CompanyRow, type Coordinator, type Module, type Role, type Session, type SlotConfig, type Ticket } from '../types';

/** Loaded for everyone as soon as they sign in. */
interface Base {
  modules: Module[];
  coordinators: Coordinator[]; // admins get everyone, a coordinator only themselves
  settings: AppSettings; // everything for admins; coordinators get the studio name, venue and time zone (the rest are defaults)
}

/** Loaded per page: a page asks for what it shows (usePageData) and it is kept up to date from then on. */
interface Records {
  tickets: Ticket[];
  clients: Client[];
  bookings: Booking[];
  slotConfigs: SlotConfig[]; // admin only
  companies: CompanyRow[]; // admin only
  notifications: AdminNotification[]; // admin only: the dashboard's messages
}

const RECORD_PATHS: Record<keyof Records, string> = { tickets: '/api/tickets', clients: '/api/clients', bookings: '/api/bookings', slotConfigs: '/api/slots', companies: '/api/clients?companies=1', notifications: '/api/audit-logs?notifications=1' };
export type Slice = keyof Records;

const EMPTY_BASE: Base = { modules: [], coordinators: [], settings: DEFAULT_SETTINGS };

/** What each kind of write can change besides its own answer: reloaded quietly afterwards, and only what is already on screen. */
const AFTER: Record<string, { slices: Slice[]; base?: boolean }> = {
  '/api/tickets': { slices: ['tickets', 'bookings', 'clients'] },
  '/api/clients': { slices: ['clients', 'tickets', 'bookings', 'companies'] },
  '/api/bookings': { slices: ['bookings', 'tickets', 'clients', 'companies', 'notifications'] },
  '/api/coordinators': { slices: [], base: true },
  '/api/modules': { slices: [], base: true },
  '/api/settings': { slices: [], base: true },
  '/api/slots': { slices: ['slotConfigs'] },
  '/api/audit-logs': { slices: ['notifications'] },
};

// A person who was signed in last time has a hint kept here (never a secret). It lets the app ask for their data at the same moment
// it asks who they are, instead of one trip after the other. A wrong hint costs nothing: the answers are thrown away.
const HINT = 'crm.signedIn';
const hinted = () => {
  try {
    return localStorage.getItem(HINT) === '1';
  } catch {
    return false;
  }
};
const hint = (on: boolean) => {
  try {
    if (on) localStorage.setItem(HINT, '1');
    else localStorage.removeItem(HINT);
  } catch {
    // private windows and blocked storage just skip the head start
  }
};
/** The pages that open on the lists, so those lists are worth fetching before the page itself has even loaded. */
const LISTS_FIRST = /^\/(admin\/(dashboard|tickets|clients|coordinators)|coordinator\/(dashboard|tickets|clients|schedule)|login)?(\/|$)/;
const STAFF_PATH = /^\/(admin|coordinator|login)?(\/|$)/;

const fetchBase = async (): Promise<Base> => {
  const [modules, coordinators, settings] = await Promise.all([api<Module[]>('/api/modules'), api<Coordinator[]>('/api/coordinators'), api<Partial<AppSettings>>('/api/settings?mine=1')]);
  return { modules, coordinators, settings: { ...DEFAULT_SETTINGS, ...settings } };
};
const fetchSlices = async (slices: Slice[]): Promise<Partial<Records>> => {
  const rows = await Promise.all(slices.map((slice) => api<unknown[]>(RECORD_PATHS[slice])));
  return Object.fromEntries(slices.map((slice, i) => [slice, rows[i]]));
};
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
/** Puts a row the server just returned into a list: replaces the same id in place, or adds it at the top. */
const upsert = <T extends { id: string }>(list: T[], row: T) => (list.some((x) => x.id === row.id) ? list.map((x) => (x.id === row.id ? row : x)) : [row, ...list]);
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
  /** Calls a write endpoint, toasts the outcome and shows the saved result straight away (the rest reloads quietly). Resolves to null when it failed. */
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
  const newest = useRef<Record<string, number>>({}); // the latest request per slice: an older answer arriving late is ignored
  // The latest state for the loaders below, which must not change identity every time data arrives.
  const loaded = useRef({ baseReady, records });
  loaded.current = { baseReady, records };

  const role = user?.role ?? null;

  // ---------- auth ----------
  // The session is an httpOnly cookie, so the browser asks the server who it belongs to. If they were signed in last time, their
  // data is requested at the same moment (one trip instead of two); a wrong guess is simply discarded.
  useEffect(() => {
    const path = window.location.pathname;
    // A client on a booking, confirmation or feedback page is nobody to sign in: no need to ask who they are (unless staff were here before).
    if (!STAFF_PATH.test(path) && !hinted()) {
      setAuthLoading(false);
      return;
    }
    const early = hinted() && STAFF_PATH.test(path) ? Promise.all([fetchBase(), fetchSlices(LISTS_FIRST.test(path) ? ['tickets', 'clients', 'bookings'] : [])]).catch(() => null) : null;
    Promise.all([api<Me>('/api/auth/me'), early])
      .then(([me, data]) => {
        if (data) {
          const slices = Object.keys(data[1]) as Slice[];
          slices.forEach((slice) => wanted.current.add(slice));
          setStudioZone(data[0].settings.timezone.tz);
          setBase(data[0]);
          setBaseReady(true);
          setRecords(data[1]);
        }
        hint(true);
        setUser(me);
      })
      .catch(() => {
        hint(false);
        setUser(null);
      })
      .finally(() => setAuthLoading(false));
  }, []);

  const clearData = useCallback(() => {
    wanted.current.clear();
    setBase(EMPTY_BASE);
    setBaseReady(false);
    setRecords({});
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const me = await api<Me>('/api/auth/login', { method: 'POST', body: { email, password } });
    hint(true);
    setUser(me);
  }, []);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    hint(false);
    setUser(null);
    clearData();
  }, [clearData]);

  // A request the server refuses with 401 means the session ended (expired, password changed, or the account was deactivated).
  const sessionEnded = useCallback(
    (e: unknown) => {
      if (!(e instanceof ApiError) || e.status !== 401) return false;
      hint(false);
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
    const mine = (newest.current.base = (newest.current.base ?? 0) + 1);
    try {
      const next = await fetchBase();
      if (mine !== newest.current.base) return;
      setStudioZone(next.settings.timezone.tz);
      setBase(next);
      setBaseReady(true);
    } catch (e) {
      fail(e, loaded.current.baseReady);
    }
  }, [role, fail]);

  const loadSlices = useCallback(
    async (slices: Slice[]) => {
      if (!role || !slices.length) return;
      const mine = slices.map((slice) => [slice, (newest.current[slice] = (newest.current[slice] ?? 0) + 1)] as const);
      try {
        const rows = await fetchSlices(slices);
        const current = slices.filter((slice) => newest.current[slice] === mine.find(([s]) => s === slice)![1]);
        setRecords((now) => ({ ...now, ...Object.fromEntries(current.map((slice) => [slice, rows[slice]])) }));
      } catch (e) {
        fail(e, slices.every((slice) => slice in loaded.current.records));
      }
    },
    [role, fail],
  );

  /** Reloads the base data and every slice a page has asked for (also what "Retry" calls). */
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

  // Load the base data on sign-in (pages ask for the rest with usePageData); already done when it came with the "who am I" answer.
  useEffect(() => {
    if (role && !loaded.current.baseReady) loadBase();
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const get = useCallback(<T,>(path: string) => api<T>(path), []);

  /** Puts what a write's own answer says straight into the screen (the saved ticket, client, coordinator, module, setting). */
  const apply = useCallback((path: string, method: string, result: unknown) => {
    const row = result as Record<string, unknown> | null;
    if (!row || typeof row !== 'object') return;
    if (path === '/api/tickets' && method === 'PATCH' && 'ticketNumber' in row) setRecords((now) => (now.tickets ? { ...now, tickets: upsert(now.tickets, row as unknown as Ticket) } : now));
    else if (path.startsWith('/api/clients') && method === 'DELETE' && 'ticketIds' in row) {
      const gone = row as unknown as { id: string; ticketIds: string[]; bookingIds: string[] };
      setRecords((now) => ({ ...now, ...(now.clients && { clients: now.clients.filter((c) => c.id !== gone.id) }), ...(now.tickets && { tickets: now.tickets.filter((t) => !gone.ticketIds.includes(t.id)) }), ...(now.bookings && { bookings: now.bookings.filter((b) => !gone.bookingIds.includes(b.id)) }) }));
    } else if (path.startsWith('/api/tickets') && method === 'DELETE' && 'bookingId' in row) setRecords((now) => ({ ...now, ...(now.tickets && { tickets: now.tickets.filter((t) => t.id !== row.id) }), ...(now.bookings && { bookings: now.bookings.filter((b) => b.id !== row.bookingId) }) }));
    else if (path === '/api/clients' && (method === 'PATCH' || method === 'POST') && 'companyName' in row) setRecords((now) => (now.clients ? { ...now, clients: upsert(now.clients, row as unknown as Client) } : now));
    else if (path === '/api/slots' && method === 'PUT' && 'moduleId' in row) setRecords((now) => (now.slotConfigs ? { ...now, slotConfigs: upsert(now.slotConfigs, row as unknown as SlotConfig) } : now));
    else if (path === '/api/coordinators' && (method === 'PATCH' || method === 'POST' || method === 'PUT') && 'email' in row) setBase((now) => ({ ...now, coordinators: upsert(now.coordinators, row as unknown as Coordinator).sort(byName) }));
    else if (path === '/api/modules' && (method === 'PATCH' || method === 'POST') && 'slug' in row) setBase((now) => ({ ...now, modules: upsert(now.modules, row as unknown as Module).sort(byName) }));
    else if (path === '/api/settings' && method === 'PUT' && 'brand' in row) {
      setStudioZone((row as unknown as AppSettings).timezone.tz);
      setBase((now) => ({ ...now, settings: { ...DEFAULT_SETTINGS, ...(row as unknown as AppSettings) } }));
    }
  }, []);

  const mutate: DataContextValue['mutate'] = useCallback(
    async (path, method, body, success) => {
      try {
        const result = await api(path, { method, body });
        if (success) toast.success(success);
        apply(path, method, result);
        // Whatever else the write may have changed is reloaded quietly: nothing waits for it.
        const after = AFTER[/^\/api\/[a-z-]+/.exec(path)?.[0] ?? ''];
        if (after) {
          if (after.base) loadBase();
          loadSlices(after.slices.filter((slice) => wanted.current.has(slice)));
        }
        return result as never;
      } catch (e) {
        if (!sessionEnded(e)) toast.error(errorMessage(e));
        return null;
      }
    },
    [apply, loadBase, loadSlices, sessionEnded],
  );

  const brandName = base.settings.brand.name;
  const exportExcel: DataContextValue['exportExcel'] = useCallback(
    async ({ ids, audit } = {}) => {
      try {
        const query = audit ? 'audit=1' : `modules=all${ids ? `&ids=${ids.join(',')}` : ''}`;
        const file = await api<Blob>(`/api/excel/download?${query}`, { blob: true });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(file);
        const brand = brandName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Studio';
        link.download = `${brand}-${audit ? 'Audit-Logs' : 'Bookings'}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
        toast.success(audit ? 'Audit log downloaded' : 'Excel downloaded');
      } catch (e) {
        if (!sessionEnded(e)) toast.error(errorMessage(e));
      }
    },
    [sessionEnded, brandName],
  );

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

  // One value that only changes when something it holds changes, so a screen is not redrawn for news that is not about it.
  const value = useMemo<DataContextValue>(
    () => ({
      ...base,
      tickets,
      clients,
      bookings,
      slotConfigs: records.slotConfigs ?? NONE,
      companies: records.companies ?? NONE,
      notifications: records.notifications ?? NONE,
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
    }),
    [base, tickets, clients, bookings, records, authLoading, user, role, signIn, signOut, maps, refresh, get, mutate, exportExcel, want, baseReady, error],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

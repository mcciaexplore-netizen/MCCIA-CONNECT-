import { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'react-hot-toast';
import { useData } from './context/DataContext';
import { homeFor, usePublicSettings } from './lib/utils';
import type { Role } from './types';
import Layout from './components/layout/Layout';
import { AuditLogs, ClientProfile, Clients, Coordinators, CreateBooking, Dashboard, FormBuilder, MyAccount, MyClients, MyDashboard, MySchedule, MyTickets, preload, Settings, SlotManager, TicketDetail, Tickets } from './lib/pages';
import BookingPage from './pages/public/BookingPage';
import ConfirmationPage from './pages/public/ConfirmationPage';
import FeedbackPage from './pages/public/FeedbackPage';
import Landing from './pages/public/Landing';
import Login from './pages/Login';

/** Needs a signed-in user with the given role; anyone else is sent to login or to their own home. */
function ProtectedRoute({ role }: { role: Role }) {
  const { authLoading, role: current } = useData();
  useEffect(() => {
    if (current === role) preload(role); // the rest of their screens, fetched quietly while the first one shows
  }, [current, role]);
  if (authLoading) return <p className="p-8 text-slate-500">Loading…</p>;
  if (!current) return <Navigate to="/login" replace />;
  if (current !== role) return <Navigate to={homeFor(current)} replace />;
  return <Layout />;
}

/** / : signed-in staff go to their own dashboard, everyone else sees the landing page. */
function Home() {
  const { authLoading, role } = useData();
  if (authLoading) return null;
  return role ? <Navigate to={homeFor(role)} replace /> : <Landing />;
}

export default function App() {
  const { brand } = usePublicSettings();
  useEffect(() => {
    document.title = brand.name;
  }, [brand.name]);
  return (
    <>
      <Suspense fallback={<p role="status" className="animate-pulse p-8 text-center text-ink-2">Loading…</p>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />

        <Route path="/admin" element={<ProtectedRoute role="super_admin" />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="tickets" element={<Tickets />} />
          <Route path="tickets/:ticketId" element={<TicketDetail />} />
          <Route path="clients" element={<Clients />} />
          <Route path="clients/:clientId" element={<ClientProfile />} />
          <Route path="coordinators" element={<Coordinators />} />
          <Route path="create-booking" element={<CreateBooking />} />
          <Route path="form-builder" element={<FormBuilder />} />
          <Route path="slot-manager" element={<SlotManager />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="/coordinator" element={<ProtectedRoute role="coordinator" />}>
          <Route path="dashboard" element={<MyDashboard />} />
          <Route path="tickets" element={<MyTickets />} />
          <Route path="tickets/:ticketId" element={<TicketDetail />} />
          <Route path="clients" element={<MyClients />} />
          <Route path="clients/:clientId" element={<ClientProfile />} />
          <Route path="schedule" element={<MySchedule />} />
          <Route path="account" element={<MyAccount />} />
        </Route>

        <Route path="/book/:moduleSlug" element={<BookingPage />} />
        <Route path="/confirmed/:bookingId" element={<ConfirmationPage />} />
        <Route path="/feedback/:token" element={<FeedbackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      <Toaster position="top-right" />
    </>
  );
}

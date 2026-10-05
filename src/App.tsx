import { Navigate, Route, Routes } from 'react-router';
import { Toaster } from 'react-hot-toast';
import { useData } from './context/DataContext';
import { homeFor } from './lib/utils';
import type { Role } from './types';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/admin/Dashboard';
import Tickets from './pages/admin/Tickets';
import TicketDetail from './pages/admin/TicketDetail';
import Clients from './pages/admin/Clients';
import ClientProfile from './pages/admin/ClientProfile';
import Coordinators from './pages/admin/Coordinators';
import CreateBooking from './pages/admin/CreateBooking';
import FormBuilder from './pages/admin/FormBuilder';
import SlotManager from './pages/admin/SlotManager';
import AuditLogs from './pages/admin/AuditLogs';
import Settings from './pages/admin/Settings';
import MyDashboard from './pages/coordinator/MyDashboard';
import MyTickets from './pages/coordinator/MyTickets';
import MyClients from './pages/coordinator/MyClients';
import MySchedule from './pages/coordinator/MySchedule';
import BookingPage from './pages/public/BookingPage';
import ConfirmationPage from './pages/public/ConfirmationPage';
import Landing from './pages/public/Landing';

/** Needs a signed-in user with the given role; anyone else is sent to login or to their own home. */
function ProtectedRoute({ role }: { role: Role }) {
  const { authLoading, role: current } = useData();
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
  return (
    <>
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
        </Route>

        <Route path="/book/:moduleSlug" element={<BookingPage />} />
        <Route path="/confirmed/:bookingId" element={<ConfirmationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-right" />
    </>
  );
}

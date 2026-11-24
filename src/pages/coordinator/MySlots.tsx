import { useData } from '../../context/DataContext';
import CoordinatorSlots from '../../components/slots/CoordinatorSlots';

/** /coordinator/slots: the coordinator's own hours, and which of their slots are free or booked (bookings from every account land here). */
export default function MySlots() {
  const { coordinator } = useData();
  return (
    <div className="max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">My slots</h1>
          <p className="page-sub">Set when you can take consultations and see which slots are free or booked. Sessions booked by the admin, by clients or from your own account all show here.</p>
        </div>
      </div>
      {coordinator && <CoordinatorSlots coordinator={coordinator} own />}
    </div>
  );
}

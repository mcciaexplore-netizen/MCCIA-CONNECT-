import PasswordCard from '../../components/settings/PasswordCard';
import { useData } from '../../context/DataContext';

/** A coordinator's own account: who they sign in as, and changing their password. */
export default function MyAccount() {
  const { user } = useData();
  return (
    <div className="max-w-2xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">My account</h1>
          <p className="page-sub">Signed in as {user?.name} ({user?.email}).</p>
        </div>
      </div>
      <PasswordCard />
    </div>
  );
}

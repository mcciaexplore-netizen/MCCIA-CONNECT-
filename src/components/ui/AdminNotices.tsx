import { useData } from '../../context/DataContext';

/** The admin dashboard's messages (for example a company that was auto-assigned a coordinator), until someone dismisses them. */
export default function AdminNotices() {
  const { notifications, mutate } = useData();
  if (!notifications.length) return null;
  return (
    <div className="mb-3 space-y-2" aria-label="Messages">
      {notifications.map((notice) => (
        <div key={notice.id} role="status" className="flex items-center justify-between gap-3 rounded-md border border-primary bg-primary-light px-4 py-2.5 text-primary-dark">
          <span className="font-medium">{notice.message}</span>
          <button className="btn" onClick={() => mutate('/api/audit-logs', 'PATCH', { id: notice.id })}>Dismiss</button>
        </div>
      ))}
      {notifications.length > 1 && (
        <button className="text-xs text-ink-2 hover:underline" onClick={() => mutate('/api/audit-logs', 'PATCH', { all: true })}>Dismiss all ({notifications.length})</button>
      )}
    </div>
  );
}

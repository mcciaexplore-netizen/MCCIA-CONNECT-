import { useEffect, useState } from 'react';
import { useData } from '../context/DataContext';
import type { AuditLog, AuditPage } from '../types';

/**
 * Every audit entry about the given records (a ticket, or a client and their tickets), newest first. Admins only.
 * Loaded again whenever `version` changes (e.g. the tickets list after an edit).
 */
export function useEntityLogs(ids: string[], enabled: boolean, version: unknown): AuditLog[] {
  const { get } = useData();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const key = ids.join(',');

  useEffect(() => {
    if (!enabled || !key) return;
    let current = true;
    get<AuditPage>(`/api/audit-logs?entities=${key}`).then((page) => current && setLogs(page.logs)).catch(() => {});
    return () => {
      current = false;
    };
  }, [get, enabled, key, version]);

  return logs;
}

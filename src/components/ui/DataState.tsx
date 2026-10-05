import type { ReactNode } from 'react';
import EmptyState from './EmptyState';

interface Props {
  loading: boolean;
  error: string;
  retry: () => void;
  children: ReactNode;
}

const bar = (width: string, height = 'h-4') => <div className={`${height} ${width} rounded bg-line`} />;

/** What a page shows while its data loads (a skeleton), when loading failed (message + Retry), and otherwise its content. */
export default function DataState({ loading, error, retry, children }: Props) {
  if (error) {
    return (
      <div className="card">
        <EmptyState icon="alert" message="Could not load this page" hint={error} action={{ label: 'Retry', onClick: retry }} />
      </div>
    );
  }
  if (loading) {
    return (
      <div role="status" aria-label="Loading" className="animate-pulse space-y-4">
        {bar('w-48', 'h-6')}
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-md bg-line" />)}
        </div>
        <div className="space-y-2 rounded-md border border-line bg-white p-4">
          {[0, 1, 2, 3, 4].map((i) => <div key={i}>{bar('w-full', 'h-5')}</div>)}
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

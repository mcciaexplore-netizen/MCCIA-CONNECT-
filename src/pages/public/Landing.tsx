import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import PublicShell from '../../components/layout/PublicShell';
import EmptyState from '../../components/ui/EmptyState';
import { moduleColor } from '../../components/ui/ModuleBadge';
import { api, errorMessage, usePublicSettings } from '../../lib/utils';
import type { LandingData } from '../../types';

/** / for visitors who are not signed in: the live booking pages as three cards. No login, nothing to remember. */
export default function Landing() {
  const { brand } = usePublicSettings();
  const [data, setData] = useState<LandingData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api<LandingData>('/api/modules?public=1', { anonymous: true })
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  const footer = (
    <>
      <p className="font-medium text-ink">{brand.name}</p>
      {data?.venue && <p className="mt-1 whitespace-pre-line">{data.venue}</p>}
      <Link to="/login" className="mt-2 inline-block text-ink-3 hover:text-primary hover:underline">Staff login</Link>
    </>
  );

  return (
    <PublicShell wide footer={footer}>
      <h1 className="text-center text-3xl font-semibold">Book a Consultation</h1>
      <p className="mx-auto mb-8 mt-2 max-w-xl text-center text-ink-2">Choose a service and pick a time that suits you. You will get a confirmation by email.</p>

      {error ? (
        <div className="card">
          <EmptyState icon="alert" message="Could not load the booking pages" hint={error} action={{ label: 'Retry', onClick: load }} />
        </div>
      ) : !data ? (
        <div role="status" aria-label="Loading" className="grid animate-pulse gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-56 rounded-md bg-line" />)}
        </div>
      ) : data.modules.length === 0 ? (
        <div className="card">
          <EmptyState icon="calendar" message="No booking pages are open right now" hint="Please check back soon." />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {data.modules.map((module) => (
            <article key={module.id} className="card flex flex-col border-t-4" style={{ borderTopColor: moduleColor(module) }} data-module={module.slug}>
              <h2 className="text-lg font-semibold">{module.name}</h2>
              <p className="mb-5 mt-2 flex-1 whitespace-pre-line text-ink-2">{module.description || 'Book a session with our team.'}</p>
              <Link to={`/book/${module.slug}`} className="btn btn-primary h-10 w-full">Book Now</Link>
            </article>
          ))}
        </div>
      )}
    </PublicShell>
  );
}

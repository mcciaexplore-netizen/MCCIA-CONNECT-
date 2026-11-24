import toast from 'react-hot-toast';
import type { Module } from '../../types';

/** A module's public booking page address, with Copy (to paste into an email or message) and Open (to preview it). */
export default function BookingLink({ module }: { module: Pick<Module, 'slug' | 'isActive'> }) {
  const link = `${window.location.origin}/book/${module.slug}`;
  const copy = () =>
    navigator.clipboard.writeText(link).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy. Select the link and copy it by hand.'),
    );

  return (
    <div className="flex min-w-0 items-center gap-2 text-ink-2">
      <span className="min-w-0 flex-1 truncate" title={link}>{link}</span>
      <button type="button" className="btn shrink-0 px-2 py-1 text-xs" onClick={copy}>Copy</button>
      <a className="btn shrink-0 px-2 py-1 text-xs" href={link} target="_blank" rel="noreferrer">Open</a>
      {!module.isActive && <span className="shrink-0 text-xs text-danger">Page is off</span>}
    </div>
  );
}

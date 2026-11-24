import toast from 'react-hot-toast';

/** A fixed file or page's address (not a module's booking page), with Copy (to paste into an email or message) and Open (to preview it). */
export default function ResourceLink({ url }: { url: string }) {
  const copy = () =>
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied'),
      () => toast.error('Could not copy. Select the link and copy it by hand.'),
    );

  return (
    <div className="flex min-w-0 items-center gap-2 text-ink-2">
      <span className="min-w-0 flex-1 truncate" title={url}>{url}</span>
      <button type="button" className="btn shrink-0 px-2 py-1 text-xs" onClick={copy}>Copy</button>
      <a className="btn shrink-0 px-2 py-1 text-xs" href={url} target="_blank" rel="noreferrer">Open</a>
    </div>
  );
}

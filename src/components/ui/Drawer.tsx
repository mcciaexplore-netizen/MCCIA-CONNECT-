import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Panel that slides in from the right over a dimmed page. Closes on Esc, the × button, or a click outside. */
export default function Drawer({ title, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/30" onMouseDown={onClose}>
      <aside role="dialog" aria-label={title} className="drawer absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" aria-label="Close" className="rounded px-2 text-lg leading-none text-ink-2 hover:bg-page" onClick={onClose}>×</button>
        </div>
        <div className="space-y-5 p-5">{children}</div>
      </aside>
    </div>
  );
}

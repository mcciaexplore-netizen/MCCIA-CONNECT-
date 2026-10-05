import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  children: ReactNode;
  wide?: boolean; // the landing page's three cards need more than the 600px booking column
  footer?: ReactNode;
}

/** The public pages' frame: a maroon MCCIA header bar over a centred column. No login involved. */
export default function PublicShell({ children, wide, footer }: Props) {
  const width = wide ? 'max-w-5xl' : 'max-w-[600px]';
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="bg-primary-dark text-white">
        <div className={cn('mx-auto flex h-14 items-center px-4', width)}>
          <span className="text-lg font-bold tracking-wider">MCCIA</span>
          <span className="ml-3 border-l border-white/30 pl-3 text-sm text-white/80">Pune AI Studio</span>
        </div>
      </header>
      <main className={cn('mx-auto w-full flex-1 px-4 py-8', width)}>{children}</main>
      {footer && <footer className="border-t border-line bg-white py-5 text-center text-xs text-ink-2">{footer}</footer>}
    </div>
  );
}

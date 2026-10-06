import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import Logo from '../ui/Logo';

interface Props {
  children: ReactNode;
  wide?: boolean; // the landing page's three cards need more than the 600px booking column
  footer?: ReactNode;
}

/** The public pages' frame: a white header bar with the MCCIA logo over a centred column. No login involved. */
export default function PublicShell({ children, wide, footer }: Props) {
  const width = wide ? 'max-w-5xl' : 'max-w-[600px]';
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="border-b-4 border-primary-dark bg-white">
        <div className={cn('mx-auto flex h-16 items-center px-4', width)}>
          <Logo className="h-9" />
        </div>
      </header>
      <main className={cn('mx-auto w-full flex-1 px-4 py-8', width)}>{children}</main>
      {footer && <footer className="border-t border-line bg-white py-5 text-center text-xs text-ink-2">{footer}</footer>}
    </div>
  );
}

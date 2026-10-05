import type { ReactNode } from 'react';

/** The public pages' frame: a maroon MCCIA header bar over a centred column (max 600px). No login involved. */
export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-page">
      <header className="bg-primary-dark text-white">
        <div className="mx-auto flex h-14 max-w-[600px] items-center px-4">
          <span className="text-lg font-bold tracking-wider">MCCIA</span>
          <span className="ml-3 border-l border-white/30 pl-3 text-sm text-white/80">Pune AI Studio</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[600px] px-4 py-8">{children}</main>
    </div>
  );
}

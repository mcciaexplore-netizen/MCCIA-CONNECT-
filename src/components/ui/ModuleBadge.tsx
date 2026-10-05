import type { Module } from '../../types';

// The three studio modules use the theme palette (blue, green, gold); any module an admin adds uses its own colour.
const BRAND: Record<string, string> = {
  'AI Consultation': 'var(--primary)',
  'Applet Setup': 'var(--accent)',
  'Cluster Development': 'var(--gold)',
};

/** The module's dot colour: theme palette for the three studio modules, else the module's own colour. */
export const moduleColor = (module: Pick<Module, 'name' | 'color'>) => BRAND[module.name] ?? module.color;

export default function ModuleBadge({ module }: { module?: Pick<Module, 'name' | 'color'> }) {
  if (!module) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: moduleColor(module) }} />
      {module.name}
    </span>
  );
}

import { cn } from '../../lib/utils';
import type { Module } from '../../types';
import { moduleColor } from './ModuleBadge';

interface Props {
  modules: Module[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/** One button per module, the chosen one highlighted (Form builder, Slot manager). */
export default function ModuleTabs({ modules, selectedId, onSelect }: Props) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {modules.map((m) => (
        <button key={m.id} onClick={() => onSelect(m.id)} className={cn('btn gap-2', m.id === selectedId && 'border-primary bg-primary-light text-primary-dark')}>
          <span className="h-2 w-2 rounded-full" style={{ background: moduleColor(m) }} />
          {m.name}
        </button>
      ))}
    </div>
  );
}

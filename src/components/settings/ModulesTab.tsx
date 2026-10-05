import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../../context/DataContext';
import EmptyState from '../ui/EmptyState';
import type { Module } from '../../types';

function ModuleCard({ module }: { module: Module }) {
  const { mutate } = useData();
  const [draft, setDraft] = useState({ name: module.name, description: module.description ?? '', color: module.color, isActive: module.isActive });
  const link = `${window.location.origin}/book/${module.slug}`;

  const save = (e: FormEvent) => {
    e.preventDefault();
    mutate('/api/modules', 'PATCH', { id: module.id, ...draft }, 'Module saved');
  };

  return (
    <form onSubmit={save} className="card grid gap-4 sm:grid-cols-2" data-module={module.name}>
      <div>
        <label className="label">Name</label>
        <input className="input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <div>
        <label className="label">Colour</label>
        <input className="h-9 w-20 cursor-pointer rounded-md border border-line-strong bg-white p-1" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description (shown on the booking page)</label>
        <textarea className="input" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
        Booking page is live
      </label>
      <div className="flex items-center gap-2 text-ink-2">
        <span className="truncate">{link}</span>
        <button type="button" className="btn shrink-0 px-2 py-1 text-xs" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success('Link copied'))}>Copy</button>
      </div>
      <div className="sm:col-span-2">
        <button className="btn btn-primary">Save</button>
      </div>
    </form>
  );
}

/** Settings > Modules: each module's name, colour, description and booking page, plus adding a module. */
export default function ModulesTab() {
  const { modules, mutate } = useData();
  const [name, setName] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await mutate('/api/modules', 'POST', { name }, 'Module created')) setName('');
  };

  return (
    <div className="space-y-4">
      {modules.length === 0 && <div className="card"><EmptyState icon="calendar" message="No modules yet" hint="Name your first one below." /></div>}
      {modules.map((module) => (
        // re-created when the saved module changes, so it never shows stale values
        <ModuleCard key={`${module.id}-${module.name}-${module.description}-${module.color}-${module.isActive}`} module={module} />
      ))}
      <form onSubmit={create} className="card flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <label className="label">New module</label>
          <input className="input" placeholder="Name, e.g. Skill Training" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn btn-primary">Add module</button>
      </form>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import ClientFields from '../../components/ui/ClientFields';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import ModuleTabs from '../../components/ui/ModuleTabs';
import { cn } from '../../lib/utils';
import { BLANK_CLIENT, CHOICE_TYPES, FEEDBACK_COMMENTS_HINT, FEEDBACK_COMMENTS_LABEL, FEEDBACK_FIELDS, FIELD_TYPES, type FieldType, type FormField, type Module } from '../../types';

const TABS = [
  { key: 'post', label: 'Post-Consultation' },
  { key: 'booking', label: 'Booking Form' },
  { key: 'feedback', label: 'Feedback Form' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Add, edit, remove and reorder the questions of one form. */
function QuestionEditor({ questions, onChange }: { questions: FormField[]; onChange: (next: FormField[]) => void }) {
  const set = (id: string, patch: Partial<FormField>) => onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const add = () => onChange([...questions, { id: crypto.randomUUID().slice(0, 8), label: '', type: 'text', required: false, options: [] }]);
  const move = (index: number, by: -1 | 1) => {
    const next = [...questions];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };

  return (
    <div>
      <div className="space-y-3">
        {questions.map((question, index) => (
          <div key={question.id} className="grid items-start gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_9rem_auto_auto_auto]" data-question>
            <input className="input" placeholder="Question" required value={question.label} onChange={(e) => set(question.id, { label: e.target.value })} />
            <select className="input" value={question.type} onChange={(e) => set(question.id, { type: e.target.value as FieldType })}>
              {FIELD_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 py-2">
              <input type="checkbox" checked={question.required} onChange={(e) => set(question.id, { required: e.target.checked })} />
              Required
            </label>
            <div className="flex gap-1">
              <button type="button" aria-label="Move up" title="Move up" className="btn px-2" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label="Move down" title="Move down" className="btn px-2" disabled={index === questions.length - 1} onClick={() => move(index, 1)}>↓</button>
            </div>
            <button type="button" className="btn btn-danger" onClick={() => onChange(questions.filter((q) => q.id !== question.id))}>Delete</button>
            {CHOICE_TYPES.includes(question.type) && (
              <textarea
                className="input sm:col-span-5"
                rows={Math.min(8, Math.max(2, question.options.length + 1))}
                placeholder="One option per line"
                value={question.options.join('\n')}
                onChange={(e) => set(question.id, { options: e.target.value.split('\n') })}
              />
            )}
          </div>
        ))}
        {questions.length === 0 && <p className="text-ink-3">No questions yet.</p>}
      </div>
      <button type="button" className="btn mt-3" onClick={add}>+ Add question</button>
    </div>
  );
}

/** One module's booking or post-consultation form. Saved with the module (PATCH /api/modules stores form_questions). */
function FormEditor({ module, form }: { module: Module; form: 'booking' | 'post' }) {
  const { mutate } = useData();
  const field = form === 'booking' ? 'questions' : 'postQuestions';
  const [questions, setQuestions] = useState(module[field]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    mutate('/api/modules', 'PATCH', { id: module.id, [field]: questions }, 'Form saved');
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {form === 'booking' ? (
        <>
          <details open className="rounded-md border border-line bg-white p-4">
            <summary className="cursor-pointer font-medium">Always asked (cannot be changed)</summary>
            <div className="mt-4">
              <ClientFields value={BLANK_CLIENT} onChange={() => {}} disabled />
            </div>
          </details>
          <p className="text-ink-2">The Membership ID is asked only of members. Questions you add here appear after those details on this module's booking page.</p>
        </>
      ) : (
        <p className="text-ink-2">Filled in by the coordinator during and after the session (the "Fill Form" button on a ticket), with one Save. Consultation Status and Payment Status are the ticket's own status and payment (payment is the admin's). Deleting a default question leaves its Excel column blank.</p>
      )}
      <QuestionEditor questions={questions} onChange={setQuestions} />
      <button className="btn btn-primary">Save form</button>
    </form>
  );
}

export default function FormBuilder() {
  const { modules } = useData();
  const navigate = useNavigate();
  const page = usePageData();
  const [moduleId, setModuleId] = useState('');
  const [tab, setTab] = useState<Tab>('post');
  const module = modules.find((m) => m.id === moduleId) ?? modules[0];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Form builder</h1>
          <p className="page-sub">The questions each module asks. New modules are added in Settings.</p>
        </div>
      </div>

      {!module ? (
        <div className="card">
          <EmptyState icon="calendar" message="No modules yet" hint="Each module has its own booking page and questions." action={{ label: 'Add a module in Settings', onClick: () => navigate('/admin/settings') }} />
        </div>
      ) : (
        <>
          <ModuleTabs modules={modules} selectedId={module.id} onSelect={setModuleId} />

          <div className="card space-y-4">
            <div className="flex gap-1 overflow-x-auto border-b border-line">
              {TABS.map(({ key, label }) => (
                <button key={key} onClick={() => setTab(key)} className={cn('-mb-px border-b-2 px-3 py-2 font-medium', tab === key ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
                  {label}
                </button>
              ))}
            </div>

            {tab === 'feedback' ? (
              <div className="space-y-3">
                <p className="text-ink-2">Emailed to the client after the session (page /feedback/…, no login). The ratings are 1 to 5 stars and required, then an optional text box. They are fixed because they fill fixed columns of the Excel file, so they cannot be edited.</p>
                <ul className="space-y-2">
                  {FEEDBACK_FIELDS.map(({ key, label }) => (
                    <li key={key} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                      {label}
                      <span className="text-gold">★★★★★</span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-4 rounded-md border border-line px-3 py-2">
                    {FEEDBACK_COMMENTS_LABEL}
                    <span className="text-right text-ink-3">Text box, optional: “{FEEDBACK_COMMENTS_HINT}”</span>
                  </li>
                </ul>
              </div>
            ) : (
              <FormEditor key={`${module.id}-${tab}`} module={module} form={tab} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

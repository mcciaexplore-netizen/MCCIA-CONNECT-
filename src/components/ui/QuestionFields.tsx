import { useState } from 'react';
import { cn } from '../../lib/utils';
import type { FormField } from '../../types';

interface Props {
  questions: FormField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  errors?: Record<string, string>; // by question id
}

/** A select question offering 'Other': the answer itself is the custom text, not the literal word 'Other'. */
const isOtherAnswer = (question: FormField, value: string) => question.type === 'select' && question.options.includes('Other') && !!value && !question.options.includes(value);

/** The inputs for a form's questions (booking form or post-consultation form), answers keyed by question id. */
export default function QuestionFields({ questions, values, onChange, errors = {} }: Props) {
  // Whether a select-with-'Other' field is showing its free-text box, by question id. Seeded from an answer that is already custom text.
  const [otherMode, setOtherMode] = useState<Record<string, boolean>>(() => Object.fromEntries(questions.map((q) => [q.id, isOtherAnswer(q, values[q.id] ?? '')])));

  return (
    <div className="space-y-4">
      {questions.map((question) => {
        const set = (value: string) => onChange({ ...values, [question.id]: value });
        const shared = { required: question.required, value: values[question.id] ?? '', className: cn('input', errors[question.id] && 'border-danger') };
        const other = question.type === 'select' && question.options.includes('Other');
        const showOtherInput = other && otherMode[question.id];
        return (
          <div key={question.id}>
            <label className="label">
              {question.label}
              {question.required && ' *'}
            </label>
            {question.type === 'textarea' ? (
              <textarea {...shared} rows={3} onChange={(e) => set(e.target.value)} />
            ) : question.type === 'select' ? (
              <>
                <select
                  {...shared}
                  value={showOtherInput ? 'Other' : shared.value}
                  onChange={(e) => {
                    const chosenOther = e.target.value === 'Other';
                    if (other) setOtherMode((m) => ({ ...m, [question.id]: chosenOther }));
                    set(chosenOther ? '' : e.target.value);
                  }}
                >
                  <option value="">Select…</option>
                  {/* An answer saved earlier stays selectable even when it is no longer one of the options (not for a field with 'Other': that's free text instead). */}
                  {(shared.value && !question.options.includes(shared.value) && !other ? [...question.options, shared.value] : question.options).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
                {showOtherInput && <input required={question.required} value={shared.value} className={cn('input mt-2', errors[question.id] && 'border-danger')} placeholder="Enter application name" onChange={(e) => set(e.target.value)} />}
              </>
            ) : question.type === 'checkbox' ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {question.options.map((option) => {
                  const chosen = shared.value.split(', ').filter(Boolean);
                  return (
                    <label key={option} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={chosen.includes(option)} onChange={(e) => set(question.options.filter((o) => (o === option ? e.target.checked : chosen.includes(o))).join(', '))} />
                      {option}
                    </label>
                  );
                })}
              </div>
            ) : question.type === 'radio' ? (
              <div className="flex flex-wrap gap-4">
                {question.options.map((option) => (
                  <label key={option} className="flex items-center gap-1.5">
                    <input type="radio" name={question.id} required={question.required} checked={values[question.id] === option} onChange={() => set(option)} />
                    {option}
                  </label>
                ))}
              </div>
            ) : (
              <input {...shared} type={question.type === 'number' ? 'number' : question.type === 'url' ? 'url' : 'text'} step="any" placeholder={question.type === 'url' ? 'https://' : undefined} onChange={(e) => set(e.target.value)} />
            )}
            {errors[question.id] && <p className="mt-1 text-xs text-danger">{errors[question.id]}</p>}
          </div>
        );
      })}
    </div>
  );
}

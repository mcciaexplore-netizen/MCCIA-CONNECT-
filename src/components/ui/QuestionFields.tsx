import { cn } from '../../lib/utils';
import type { FormField } from '../../types';

interface Props {
  questions: FormField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  errors?: Record<string, string>; // by question id
}

/** The inputs for a form's questions (booking form or post-consultation form), answers keyed by question id. */
export default function QuestionFields({ questions, values, onChange, errors = {} }: Props) {
  return (
    <div className="space-y-4">
      {questions.map((question) => {
        const set = (value: string) => onChange({ ...values, [question.id]: value });
        const shared = { required: question.required, value: values[question.id] ?? '', className: cn('input', errors[question.id] && 'border-primary') };
        return (
          <div key={question.id}>
            <label className="label">
              {question.label}
              {question.required && ' *'}
            </label>
            {question.type === 'textarea' ? (
              <textarea {...shared} rows={3} onChange={(e) => set(e.target.value)} />
            ) : question.type === 'select' ? (
              <select {...shared} onChange={(e) => set(e.target.value)}>
                <option value="">Select…</option>
                {question.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
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
              <input {...shared} type={question.type === 'number' ? 'number' : 'text'} step="any" onChange={(e) => set(e.target.value)} />
            )}
            {errors[question.id] && <p className="mt-1 text-xs text-primary">{errors[question.id]}</p>}
          </div>
        );
      })}
    </div>
  );
}

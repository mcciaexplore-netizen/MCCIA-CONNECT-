import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { CLIENT_FIELDS, type ClientField, type ClientInput } from '../../types';

interface Props {
  value: ClientInput;
  onChange: (next: ClientInput) => void;
  errors?: Partial<Record<keyof ClientInput, string>>; // shown under the fields (see validateClient)
  disabled?: boolean; // read-only, e.g. an existing client's details
  keys?: (keyof ClientInput)[]; // only these fields (editing a company's own details)
  relaxed?: boolean; // only the company name is required (old records may have gaps)
}

/** The 17 client details of CLIENT_FIELDS, in booking-form order. Shared by the public booking wizard, Create booking, Add client and the Form builder. */
export default function ClientFields({ value, onChange, errors = {}, disabled, keys, relaxed }: Props) {
  const set = (patch: Partial<ClientInput>) => onChange({ ...value, ...patch });

  const radios = (name: string, options: readonly string[], selected: string, pick: (option: string) => void) => (
    <div className="flex flex-wrap items-center gap-6">
      {options.map((option) => (
        <label key={option} className="flex items-center gap-2">
          <input type="radio" name={name} checked={selected === option} onChange={() => pick(option)} />
          {option}
        </label>
      ))}
    </div>
  );

  const control = ({ key, type, required, options, placeholder }: ClientField): ReactNode => {
    const text = String(value[key]);
    if (type === 'member') return radios('member', ['Member', 'Non-Member'], value.isMember ? 'Member' : 'Non-Member', (option) => set({ isMember: option === 'Member' }));
    if (type === 'select') {
      // A value saved earlier (free text) stays selectable even when it is not one of the listed choices.
      const list = options ?? [];
      return (
        <select id={`client-${key}`} className={cn('input', errors[key] && 'border-danger')} required={required} value={text} onChange={(e) => set({ [key]: e.target.value })}>
          <option value="">Select…</option>
          {(text && !list.includes(text) ? [...list, text] : list).map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        id={`client-${key}`}
        className={cn('input', errors[key] && 'border-danger')}
        type={type}
        inputMode={type === 'tel' || type === 'number' ? 'numeric' : undefined}
        min={type === 'number' ? 0 : undefined}
        required={required}
        placeholder={placeholder}
        value={text}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    );
  };

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {CLIENT_FIELDS.filter((field) => (!keys || keys.includes(field.key)) && (field.key !== 'membershipId' || value.isMember)).map((shown) => {
        const field = { ...shown, required: relaxed ? shown.key === 'companyName' : shown.required };
        const radio = field.type === 'member';
        return (
          <div key={field.key} className={field.type === 'member' ? 'sm:col-span-2' : undefined}>
            {radio ? <p className="label">{field.label}{field.required && ' *'}</p> : <label className="label" htmlFor={`client-${field.key}`}>{field.label}{field.required && ' *'}</label>}
            {control(field)}
            {errors[field.key] && <p className="mt-1 text-xs text-danger">{errors[field.key]}</p>}
          </div>
        );
      })}
    </fieldset>
  );
}

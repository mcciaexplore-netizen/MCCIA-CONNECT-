import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ACQUISITION_OPTIONS, INDUSTRY_OPTIONS, SCALE_OPTIONS, type ClientInput } from '../../types';

type TextKey = 'companyName' | 'personName' | 'email' | 'phone' | 'udyamNo' | 'jobTitle' | 'membershipId';
type ChoiceKey = 'scale' | 'industry' | 'acquisitionFrom';

interface Props {
  value: ClientInput;
  onChange: (next: ClientInput) => void;
  errors?: Partial<Record<keyof ClientInput, string>>; // shown under the fields (see validateClient)
  disabled?: boolean; // read-only, e.g. an existing client's details
}

/** The 10 client details, in booking-form order. Shared by the public booking wizard, Create booking and Add client. */
export default function ClientFields({ value, onChange, errors = {}, disabled }: Props) {
  const set = (patch: Partial<ClientInput>) => onChange({ ...value, ...patch });
  const wrap = (key: keyof ClientInput, label: string, control: ReactNode) => (
    <div>
      <label className="label">{label}</label>
      {control}
      {errors[key] && <p className="mt-1 text-xs text-primary">{errors[key]}</p>}
    </div>
  );
  const text = (key: TextKey, label: string, extra: { required?: boolean; type?: string; placeholder?: string } = {}) =>
    wrap(
      key,
      extra.required ? `${label} *` : label,
      <input
        className={cn('input', errors[key] && 'border-primary')}
        type={extra.type ?? 'text'}
        inputMode={extra.type === 'tel' ? 'numeric' : undefined}
        required={extra.required}
        placeholder={extra.placeholder}
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value })}
      />,
    );
  // A value saved earlier (free text) stays selectable even when it is not one of the listed choices.
  const choice = (key: ChoiceKey, label: string, options: readonly string[]) =>
    wrap(
      key,
      label,
      <select className="input" value={value[key]} onChange={(e) => set({ [key]: e.target.value })}>
        <option value="">Select…</option>
        {(value[key] && !options.includes(value[key]) ? [...options, value[key]] : options).map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>,
    );

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {text('companyName', 'Company Name', { required: true })}
      {text('personName', 'Person Name', { required: true })}
      {text('email', 'Email', { required: true, type: 'email' })}
      {text('phone', 'Phone', { required: true, type: 'tel', placeholder: '10-digit mobile number' })}
      {choice('scale', 'Scale', SCALE_OPTIONS)}
      {choice('industry', 'Industry', INDUSTRY_OPTIONS)}
      {text('udyamNo', 'UDYAM No.')}
      {text('jobTitle', 'Job Title', { required: true })}
      <div className="sm:col-span-2">
        <p className="label">Member / Non-Member *</p>
        <div className="flex flex-wrap items-center gap-6">
          {[true, false].map((member) => (
            <label key={String(member)} className="flex items-center gap-2">
              <input type="radio" name="member" checked={value.isMember === member} onChange={() => set({ isMember: member })} />
              {member ? 'Member' : 'Non-Member'}
            </label>
          ))}
          {value.isMember && (
            <input className="input max-w-52" placeholder="Membership ID" value={value.membershipId} onChange={(e) => set({ membershipId: e.target.value })} />
          )}
        </div>
      </div>
      <div className="sm:col-span-2">{choice('acquisitionFrom', 'Acquisition From', ACQUISITION_OPTIONS)}</div>
    </fieldset>
  );
}

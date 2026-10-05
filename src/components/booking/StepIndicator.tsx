import { cn } from '../../lib/utils';

const PUBLIC_STEPS = ['Your Details', 'Choose Slot', 'Confirm'];

/** Numbered steps (the public booking wizard's three by default). Finished steps show a tick. */
export default function StepIndicator({ step, steps = PUBLIC_STEPS }: { step: number; steps?: string[] }) {
  return (
    <ol className="mb-6 flex items-center">
      {steps.map((label, i) => {
        const number = i + 1;
        const reached = step >= number;
        return (
          <li key={label} className={cn('flex items-center', number < steps.length && 'flex-1')} aria-current={step === number ? 'step' : undefined}>
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', reached ? 'bg-primary text-white' : 'bg-line text-ink-2')}>
              {step > number ? '✓' : number}
            </span>
            <span className={cn('ml-2 whitespace-nowrap text-xs font-medium', step === number ? 'text-ink' : 'hidden text-ink-2 sm:inline')}>{label}</span>
            {number < steps.length && <span className={cn('mx-3 h-px flex-1', step > number ? 'bg-primary' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

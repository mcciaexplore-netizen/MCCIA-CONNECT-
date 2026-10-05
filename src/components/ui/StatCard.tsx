import { cn } from '../../lib/utils';
import Icon, { type IconName } from './Icon';

interface Props {
  label: string;
  value: number | string;
  hint?: string;
  icon?: IconName;
  highlight?: boolean; // gold: something needs attention
}

export default function StatCard({ label, value, hint, icon, highlight }: Props) {
  const text = (
    <>
      <p className="truncate text-sm text-ink-2">{label}</p>
      <p className={cn('mt-1 truncate font-semibold', typeof value === 'number' ? 'text-3xl' : 'text-xl leading-9')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </>
  );
  return (
    <div className={cn('card', icon && 'flex items-center gap-3', highlight && 'border-gold bg-gold-light')}>
      {icon ? (
        <>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary">
            <Icon name={icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">{text}</div>
        </>
      ) : (
        text
      )}
    </div>
  );
}

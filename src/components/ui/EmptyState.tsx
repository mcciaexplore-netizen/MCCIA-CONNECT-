import Icon, { type IconName } from './Icon';

interface Props {
  icon?: IconName;
  message: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
}

/** Nothing to show (or something went wrong): an icon, a message and, when there is a way forward, a button. */
export default function EmptyState({ icon = 'calendar', message, hint, action }: Props) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="text-base font-semibold">{message}</p>
      {hint && <p className="mt-1 max-w-md text-ink-2">{hint}</p>}
      {action && <button className="btn btn-primary mt-4" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

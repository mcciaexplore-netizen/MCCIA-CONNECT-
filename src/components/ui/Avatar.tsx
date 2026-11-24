import { cn } from '../../lib/utils';

const SIZES = { sm: 'h-6 w-6 text-[10px]', md: 'h-8 w-8 text-xs', lg: 'h-14 w-14 text-lg' };

interface Props {
  name: string;
  color?: string; // any CSS colour; defaults to the brand red
  size?: keyof typeof SIZES;
}

/** Circle with the initials of the first two words of the name. */
export default function Avatar({ name, color = 'var(--primary)', size = 'md' }: Props) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return (
    <span className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', SIZES[size])} style={{ background: color }}>
      {initials || '?'}
    </span>
  );
}

import { cn, usePublicSettings } from '../../lib/utils';

/** The MCCIA logo (public/mccia-logo.png). It stands in for the studio's name as text; the name stays as the picture's alt text. */
export default function Logo({ className }: { className?: string }) {
  const { brand } = usePublicSettings();
  return <img src="/mccia-logo.png" alt={brand.name} width={268} height={72} className={cn('w-auto select-none', className)} />;
}

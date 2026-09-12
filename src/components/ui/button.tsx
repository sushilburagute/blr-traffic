import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';
export function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'icon';
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn('btn', `btn-${variant}`, `btn-${size}`, className)} {...props} />;
}

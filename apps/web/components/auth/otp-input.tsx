'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** Single 6-digit code field: numeric keypad, SMS/email autofill, monospaced digits. */
export const OtpInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      pattern="\d{6}"
      className={cn('font-mono text-h3 tracking-[0.5em]', className)}
      {...props}
    />
  ),
);
OtpInput.displayName = 'OtpInput';

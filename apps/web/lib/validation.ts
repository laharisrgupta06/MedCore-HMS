import { checkPassword, Gender, PASSWORD_POLICY } from '@medcore/types';
import { z } from 'zod';

/** Client-side validation mirrors the API DTOs (the API remains the authority). */
export const email = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('Enter a valid email address.');
export const otp = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code.');
export const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, for example +919876543210.');
export const personName = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}.`)
    .max(80, `${label[0]?.toUpperCase()}${label.slice(1)} is too long.`)
    .regex(
      /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u,
      `${label[0]?.toUpperCase()}${label.slice(1)} contains unsupported characters.`,
    );

export const newPassword = z
  .string()
  .min(PASSWORD_POLICY.minLength, `Use at least ${PASSWORD_POLICY.minLength} characters.`)
  .max(PASSWORD_POLICY.maxLength, `Use at most ${PASSWORD_POLICY.maxLength} characters.`)
  .regex(PASSWORD_POLICY.pattern, 'Include at least one letter and one number.');

export const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.') });

export const registerSchema = z
  .object({
    hospitalCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,20}$/, 'Hospital codes are 3 to 20 letters, digits or hyphens.'),
    firstName: personName('your first name'),
    lastName: personName('your last name'),
    email,
    phone: z.union([z.literal(''), phone]),
    dateOfBirth: z
      .string()
      .min(1, 'Enter your date of birth.')
      .refine(
        (v) => !Number.isNaN(Date.parse(v)) && new Date(v) <= new Date(),
        'Enter a past date.',
      ),
    gender: z.enum(Object.values(Gender) as [Gender, ...Gender[]], {
      message: 'Select an option.',
    }),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .superRefine((v, ctx) => {
    const problem = checkPassword(v.password, v.email);
    if (problem && v.password.length >= PASSWORD_POLICY.minLength)
      ctx.addIssue({ code: 'custom', path: ['password'], message: problem });
    if (v.password !== v.confirmPassword)
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'Passwords do not match.',
      });
  });

export const resetSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });

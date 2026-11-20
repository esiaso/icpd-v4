'use client';
import { useForm, type UseFormProps, type FieldValues, type UseFormReturn, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ZodSchema } from 'zod';
import { toast } from 'sonner';
import { ApiError } from './api';

export function useZodForm<T extends FieldValues>(schema: ZodSchema<any>, opts: Omit<UseFormProps<T>, 'resolver'> = {}): UseFormReturn<T> {
  return useForm<T>({ ...opts, resolver: zodResolver(schema) }) as UseFormReturn<T>;
}

/** Map an API error onto form fields (422 details.fields) or show a toast. Returns the message. */
export function applyApiError<T extends FieldValues>(form: Pick<UseFormReturn<T>, 'setError'> | null, e: unknown): string {
  if (e instanceof ApiError) {
    const fields = e.fields;
    let mapped = false;
    if (form) {
      for (const [k, msg] of Object.entries(fields)) {
        form.setError(k as Path<T>, { message: msg });
        mapped = true;
      }
    }
    if (!mapped) toast.error(e.message);
    return e.message;
  }
  toast.error('Something went wrong. Please try again.');
  return 'Something went wrong';
}

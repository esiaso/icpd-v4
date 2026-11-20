import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { AppError } from './errors';

/** Validate a body/query with a Zod schema; errors become 422 VALIDATION with field details. */
@Injectable()
export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown, _meta: ArgumentMetadata): T {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      const fields: Record<string, string> = {};
      for (const i of r.error.issues) fields[i.path.join('.') || '_'] ??= i.message;
      throw new AppError('VALIDATION', Object.values(fields)[0] ?? 'Invalid input', 422, { fields });
    }
    return r.data;
  }
}

export const Z = <T>(schema: ZodSchema<T>) => new ZodPipe<T>(schema);

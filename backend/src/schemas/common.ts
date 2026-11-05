import { z } from 'zod';

/** Wraps a route's data schema in the standard success envelope. */
export function successSchema<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data });
}

export const errorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof errorSchema>;

export function ok<T>(data: T) {
  return { success: true as const, data };
}

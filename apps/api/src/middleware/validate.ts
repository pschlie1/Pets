import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ApiError } from './errors';

/** Validates req.body against a zod schema; 400 with the specific failures. */
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new ApiError(400, 'validation_error', 'Request body failed validation.', result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }))),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

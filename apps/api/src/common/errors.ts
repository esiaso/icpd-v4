import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';

/** Domain error with a stable code. Rendered as { error: { code, message, details } }. */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const NotFound = (what = 'Resource', details?: unknown) =>
  new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND, details);
export const Forbidden = (message = 'You do not have permission to do this') =>
  new AppError('FORBIDDEN', message, HttpStatus.FORBIDDEN);
export const Unauthorized = (message = 'Authentication required') =>
  new AppError('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
export const BadRequest = (message: string, details?: unknown, code = 'BAD_REQUEST') =>
  new AppError(code, message, HttpStatus.BAD_REQUEST, details);
export const Conflict = (message: string, details?: unknown) =>
  new AppError('CONFLICT', message, HttpStatus.CONFLICT, details);
export const Unprocessable = (message: string, details?: unknown, code = 'UNPROCESSABLE') =>
  new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Something went wrong';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      code = 'RATE_LIMITED';
      message = 'Too many requests, please slow down';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      code = typeof body === 'object' && body?.code ? body.code : HttpStatus[status] ?? 'ERROR';
      message =
        typeof body === 'string'
          ? body
          : Array.isArray(body?.message)
            ? body.message.join(', ')
            : (body?.message ?? exception.message);
      details = typeof body === 'object' ? body?.details : undefined;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        code = 'CONFLICT';
        message = 'A record with these values already exists';
        details = exception.meta;
      } else if (exception.code === 'P2025') {
        status = 404;
        code = 'NOT_FOUND';
        message = 'Record not found';
      } else {
        this.logger.error(exception);
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }
    res.status(status).json({ error: { code, message, details } });
  }
}

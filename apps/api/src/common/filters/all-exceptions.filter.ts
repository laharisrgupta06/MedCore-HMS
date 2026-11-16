import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { CommonErrorCode, type ApiError } from '@medcore/types';
import * as Sentry from '@sentry/node';
import type { Request, Response } from 'express';

const DEFAULT_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: CommonErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: CommonErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: CommonErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: CommonErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: CommonErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: CommonErrorCode.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: CommonErrorCode.SERVICE_UNAVAILABLE,
};

function defaultCode(status: number): string {
  return (
    DEFAULT_CODES[status] ?? (status >= 500 ? CommonErrorCode.INTERNAL_ERROR : `HTTP_${status}`)
  );
}

/** Converts any thrown value into the PRD error envelope. Never leaks internals for 5xx. */
export function toErrorResponse(exception: unknown): { status: number; body: ApiError } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    let code = defaultCode(status);
    let message = exception.message;
    let details: unknown;
    if (typeof response === 'object' && response !== null) {
      const r = response as Record<string, unknown>;
      if (typeof r.code === 'string') code = r.code;
      if (typeof r.message === 'string') message = r.message;
      else if (Array.isArray(r.message)) {
        message = 'Request validation failed';
        details = r.message;
      }
      if (r.details !== undefined) details = r.details;
    }
    if (status >= 500) message = status === 503 ? message : 'An unexpected error occurred.';
    return {
      status,
      body: {
        success: false,
        error: { code, message, ...(details !== undefined ? { details } : {}) },
      },
    };
  }

  // Errors from Express middleware (e.g. malformed JSON, payload too large) carry a 4xx status.
  const status = (exception as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return {
      status,
      body: {
        success: false,
        error: { code: defaultCode(status), message: 'The request could not be processed.' },
      },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      success: false,
      error: { code: CommonErrorCode.INTERNAL_ERROR, message: 'An unexpected error occurred.' },
    },
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) {
      Sentry.captureException(exception);
      this.logger.error(
        `${req.method} ${req.path} -> ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    res.status(status).json(body);
  }
}

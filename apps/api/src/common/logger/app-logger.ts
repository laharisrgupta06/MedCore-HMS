import { ConsoleLogger } from '@nestjs/common';
import { sanitize } from './sanitize';

/** Nest logger that passes every message and parameter through the sanitiser. */
export class AppLogger extends ConsoleLogger {
  override log(message: unknown, ...params: unknown[]): void {
    super.log(sanitize(message), ...params.map((p) => sanitize(p)));
  }
  override error(message: unknown, ...params: unknown[]): void {
    super.error(sanitize(message), ...params.map((p) => sanitize(p)));
  }
  override warn(message: unknown, ...params: unknown[]): void {
    super.warn(sanitize(message), ...params.map((p) => sanitize(p)));
  }
  override debug(message: unknown, ...params: unknown[]): void {
    super.debug(sanitize(message), ...params.map((p) => sanitize(p)));
  }
  override verbose(message: unknown, ...params: unknown[]): void {
    super.verbose(sanitize(message), ...params.map((p) => sanitize(p)));
  }
}

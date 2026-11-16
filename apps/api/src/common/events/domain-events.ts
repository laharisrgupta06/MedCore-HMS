import { Global, Injectable, Logger, Module } from '@nestjs/common';

/**
 * Domain events (DEC-040 D5): modules announce what happened; subscribers (PDF jobs now,
 * notifications in Phase 9, billing in Phase 8) react without the publisher knowing them.
 * Published after the transaction commits. A failing subscriber is logged and never fails the
 * request that published the event.
 */
export type DomainEvent =
  | { type: 'prescription.issued'; hospitalId: string; prescriptionId: string }
  | { type: 'prescription.cancelled'; hospitalId: string; prescriptionId: string }
  | { type: 'prescription.ready'; hospitalId: string; prescriptionId: string }
  | { type: 'lab.report.approved'; hospitalId: string; labOrderId: string }
  | { type: 'stock.low'; hospitalId: string; medicineId: string }
  | { type: 'stock.expiring'; hospitalId: string; reportId: string };

type Handler<T extends DomainEvent['type']> = (
  e: Extract<DomainEvent, { type: T }>,
) => Promise<void> | void;

@Injectable()
export class DomainEvents {
  private readonly log = new Logger('DomainEvents');
  private readonly handlers = new Map<string, ((e: DomainEvent) => Promise<void> | void)[]>();
  /** Every event published in this process, newest last (bounded); used by tests and diagnostics. */
  readonly recent: DomainEvent[] = [];

  on<T extends DomainEvent['type']>(type: T, handler: Handler<T>): void {
    const h = handler as unknown as (e: DomainEvent) => Promise<void> | void;
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), h]);
  }

  async publish(event: DomainEvent): Promise<void> {
    this.recent.push(event);
    if (this.recent.length > 200) this.recent.shift();
    for (const h of this.handlers.get(event.type) ?? []) {
      try {
        await h(event);
      } catch (e) {
        this.log.error(`Subscriber for ${event.type} failed: ${(e as Error).message}`);
      }
    }
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class DomainEventsModule {}

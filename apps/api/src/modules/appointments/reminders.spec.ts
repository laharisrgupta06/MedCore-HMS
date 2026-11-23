import { assertBullAccepts } from '../../testing/validating-queue';
import { BullReminderScheduler, sendReminder } from './reminders';

/** APPT-005: reminders 24 h and 1 h before, skipped when the appointment changed. */
describe('appointment reminders', () => {
  const start = new Date('2030-03-04T04:30:00.000Z');
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    hospitalId: 'h1',
    status: 'CONFIRMED',
    scheduledAt: start,
    hospital: { name: 'City Hospital', timezone: 'Asia/Kolkata' },
    patient: { userId: 'u-patient' },
    ...over,
  });
  const setup = (r: unknown, staged = [{ id: 'd1', channel: 'EMAIL' }]) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      appointment: { findUnique: jest.fn().mockResolvedValue(r) },
    };
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    const writer = {
      stage: jest.fn().mockResolvedValue(staged),
      dispatch: jest.fn().mockResolvedValue(undefined),
    };
    return { prisma, writer, tx };
  };
  const job = { appointmentId: 'a1', scheduledAt: start.toISOString(), offset: '24h' as const };

  it('locks the appointment and stages one durable reminder in hospital-local time', async () => {
    const { prisma, writer, tx } = setup(row());
    expect(await sendReminder(prisma as never, writer as never, job)).toBe('sent');
    expect(tx.$queryRaw).toHaveBeenCalled();
    const input = writer.stage.mock.calls[0][1];
    expect(input.recipientIds).toEqual(['u-patient']);
    expect(input.hospitalId).toBe('h1');
    expect(input.content.type).toBe('appointment.reminder.24h');
    expect(input.content.once).toBe('same-body');
    expect(input.content.channels).toEqual(['IN_APP', 'EMAIL', 'SMS']);
    expect(input.content.body).toContain('10:00'); // 04:30 UTC = 10:00 IST
    expect(input.content.body).toContain('City Hospital');
    expect(writer.dispatch).toHaveBeenCalledWith([{ id: 'd1', channel: 'EMAIL' }]);
  });

  it('reports a duplicate (already reminded for this time) as skipped and queues nothing', async () => {
    const { prisma, writer } = setup(row(), []);
    expect(await sendReminder(prisma as never, writer as never, job)).toBe('skipped');
    expect(writer.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', row({ status: 'CANCELLED' })],
    ['completed', row({ status: 'COMPLETED' })],
    ['rescheduled', row({ scheduledAt: new Date('2030-03-05T04:30:00.000Z') })],
    ['deleted', null],
  ])('skips a %s appointment', async (_, r) => {
    const { prisma, writer } = setup(r);
    expect(await sendReminder(prisma as never, writer as never, job)).toBe('skipped');
    expect(writer.stage).not.toHaveBeenCalled();
  });

  it('queues only reminders still in the future, with stable job ids, replacing earlier ones', async () => {
    const removed: string[] = [];
    const queue = {
      add: jest.fn(async (name: string, data: unknown, opts: object) =>
        assertBullAccepts(name, data, opts),
      ),
      getJob: jest.fn(async (id: string) => ({ remove: async () => void removed.push(id) })),
    };
    const s = new BullReminderScheduler(queue as never);
    await s.schedule('a1', new Date(Date.now() + 3 * 3_600_000));
    // New ids, plus the pre-Phase 6 ids so reminders queued before the change are still replaced.
    expect(removed).toEqual([
      'reminder-a1-24h',
      'reminder:a1:24h',
      'reminder-a1-1h',
      'reminder:a1:1h',
    ]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, data, opts] = queue.add.mock.calls[0] as [
      string,
      unknown,
      { jobId: string; delay: number },
    ];
    expect(data).toMatchObject({ appointmentId: 'a1', offset: '1h' });
    expect(opts.jobId).toBe('reminder-a1-1h');
    expect(opts.delay).toBeGreaterThan(2 * 3_600_000 - 5_000);
    expect(opts.delay).toBeLessThanOrEqual(2 * 3_600_000);
  });
});

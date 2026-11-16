import { assertBullAccepts } from '../../testing/validating-queue';
import { BullReminderScheduler, sendReminder } from './reminders';

/** APPT-005: reminders 24 h and 1 h before, skipped when the appointment changed. */
describe('appointment reminders', () => {
  const start = new Date('2030-03-04T04:30:00.000Z');
  const row = (over: Record<string, unknown> = {}, phoneVerified = true) => ({
    id: 'a1',
    status: 'CONFIRMED',
    scheduledAt: start,
    hospital: { name: 'City Hospital', timezone: 'Asia/Kolkata' },
    doctor: { user: { firstName: 'Dee', lastName: 'Rao' } },
    patient: {
      user: {
        email: 'p@example.com',
        firstName: 'Pat',
        phone: '+919800000000',
        phoneVerifiedAt: phoneVerified ? new Date() : null,
      },
    },
    ...over,
  });
  const setup = (r: unknown) => {
    const mail = { send: jest.fn().mockResolvedValue(undefined) };
    const sms = { send: jest.fn().mockResolvedValue(undefined) };
    const prisma = { appointment: { findUnique: jest.fn().mockResolvedValue(r) } };
    return { mail, sms, prisma };
  };
  const job = { appointmentId: 'a1', scheduledAt: start.toISOString(), offset: '24h' as const };

  it('emails the patient in hospital-local time and texts a verified phone', async () => {
    const { mail, sms, prisma } = setup(row());
    expect(await sendReminder(prisma as never, mail as never, sms as never, job)).toBe('sent');
    const sent = mail.send.mock.calls[0][0];
    expect(sent.to).toBe('p@example.com');
    expect(sent.text).toContain('Dr Dee Rao at City Hospital is tomorrow');
    expect(sent.text).toContain('10:00'); // 04:30 UTC = 10:00 IST
    expect(sms.send).toHaveBeenCalledWith(expect.objectContaining({ to: '+919800000000' }));
  });

  it('does not text an unverified phone', async () => {
    const { mail, sms, prisma } = setup(row({}, false));
    await sendReminder(prisma as never, mail as never, sms as never, job);
    expect(mail.send).toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', row({ status: 'CANCELLED' })],
    ['completed', row({ status: 'COMPLETED' })],
    ['rescheduled', row({ scheduledAt: new Date('2030-03-05T04:30:00.000Z') })],
    ['deleted', null],
  ])('skips a %s appointment', async (_, r) => {
    const { mail, sms, prisma } = setup(r);
    expect(await sendReminder(prisma as never, mail as never, sms as never, job)).toBe('skipped');
    expect(mail.send).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
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

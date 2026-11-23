import { CONTENT } from './notification-content';
import { NotificationWriter, dedupeKey } from './notification.writer';

/** DEC-062: rows staged in the caller's transaction; jobs queued only by dispatch. */
describe('NotificationWriter', () => {
  const tx = (existing: Record<string, unknown> | null = null, conflict = false) => {
    let n = 0;
    return {
      notification: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: `n${++n}` })),
        // ON CONFLICT DO NOTHING: no row back when the duplicate key already exists.
        createManyAndReturn: jest
          .fn()
          .mockImplementation(() => Promise.resolve(conflict ? [] : [{ id: `n${++n}` }])),
      },
      notificationDelivery: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `${data.notificationId}-${data.channel}`,
            channel: data.channel,
          }),
        ),
      },
    };
  };
  const input = (content = CONTENT.appointmentConfirmed(), recipientIds = ['u1', 'u1', 'u2']) => ({
    hospitalId: 'h1',
    recipientIds,
    content,
    entityType: 'Appointment',
    entityId: 'a1',
  });

  it('writes one notification per distinct recipient and one delivery per channel, in the given transaction', async () => {
    const t = tx();
    const w = new NotificationWriter({} as never);
    const staged = await w.stage(t as never, input());
    expect(t.notification.createManyAndReturn).toHaveBeenCalledTimes(2);
    expect(staged.map((s) => s.channel)).toEqual([
      'IN_APP',
      'EMAIL',
      'SMS',
      'IN_APP',
      'EMAIL',
      'SMS',
    ]);
    const call = t.notification.createManyAndReturn.mock.calls[0][0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[0]).toMatchObject({
      hospitalId: 'h1',
      recipientId: 'u1',
      type: 'appointment.confirmed',
      dedupeKey: 'appointment.confirmed:a1',
    });
  });

  it('skips a once notification that a concurrent transaction wrote first (M-15 key), without throwing', async () => {
    const t = tx(null, true);
    const staged = await new NotificationWriter({} as never).stage(t as never, input());
    expect(staged).toEqual([]);
    expect(t.notificationDelivery.create).not.toHaveBeenCalled();
  });

  it('keys reminders by body, so a moved appointment gets new reminders', () => {
    const a = dedupeKey(CONTENT.appointmentReminder('Mon 10:00 at City', '24h'), 'a1');
    const b = dedupeKey(CONTENT.appointmentReminder('Tue 11:00 at City', '24h'), 'a1');
    expect(a).toMatch(/^appointment\.reminder\.24h:a1:[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });

  it('skips a once notification that already exists, and matches reminders by body (appointment time)', async () => {
    const t = tx({ id: 'old' });
    const w = new NotificationWriter({} as never);
    expect(await w.stage(t as never, input())).toEqual([]);
    await w.stage(
      t as never,
      input(CONTENT.appointmentReminder('Mon 10:00 at City', '24h'), ['u1']),
    );
    expect(t.notification.findFirst.mock.calls.at(-1)[0].where).toMatchObject({
      type: 'appointment.reminder.24h',
      body: expect.stringContaining('Mon 10:00'),
    });
  });

  it('does not deduplicate repeatable notifications (reschedules)', async () => {
    const t = tx({ id: 'old' });
    const staged = await new NotificationWriter({} as never).stage(
      t as never,
      input(CONTENT.appointmentRescheduled(), ['u1']),
    );
    expect(t.notification.findFirst).not.toHaveBeenCalled();
    expect(t.notification.create.mock.calls[0][0].data.dedupeKey).toBeUndefined();
    expect(staged).toHaveLength(2);
  });

  it('dispatch queues committed deliveries and never throws when the queue fails', async () => {
    const queue = { enqueue: jest.fn().mockRejectedValue(new Error('redis down')) };
    const w = new NotificationWriter({} as never, queue);
    await expect(
      w.dispatch([{ id: 'd1', channel: 'EMAIL' }], undefined, []),
    ).resolves.toBeUndefined();
    expect(queue.enqueue).toHaveBeenCalledWith([{ id: 'd1', channel: 'EMAIL' }]);
  });

  it('email and SMS text carries no clinical details (DEC-065)', () => {
    for (const f of Object.values(CONTENT)) {
      const c = (f as (...a: string[]) => { title: string; body: string })(
        'Mon 10:00 at City',
        '24h',
      );
      expect(`${c.title} ${c.body}`).not.toMatch(/diagnos|result|test name|medicine name|mg\b/i);
    }
  });
});

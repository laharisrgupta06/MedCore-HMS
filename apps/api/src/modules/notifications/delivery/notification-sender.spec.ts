import { NOTIFICATION_SOCKET_EVENTS } from '@medcore/types';
import { MAX_DELIVERY_ATTEMPTS } from './notification-dispatch';
import { NotificationSender } from './notification-sender';

/** Phase 9/13: delivery tracking, retries, the verified-phone rule and privacy of stored errors. */
describe('NotificationSender', () => {
  const recipient = (over = {}) => ({
    email: 'pat@example.com',
    phone: '+919800000000',
    phoneVerifiedAt: new Date(),
    firstName: 'Pat',
    isActive: true,
    ...over,
  });
  const delivery = (channel: string, over: Record<string, unknown> = {}, who = recipient()) => ({
    id: 'd1',
    channel,
    status: 'PENDING',
    attempts: 0,
    notification: {
      id: 'n1',
      recipientId: 'u1',
      type: 'lab.report.ready',
      title: 'Lab report ready',
      body: 'A lab report is ready to view in your portal.',
      entityType: 'LabOrder',
      entityId: 'l1',
      readAt: null,
      createdAt: new Date('2026-11-22T00:00:00Z'),
      recipient: who,
    },
    ...over,
  });
  const make = (d: unknown, opts: { mailFails?: Error } = {}) => {
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      notificationDelivery: {
        findUnique: jest.fn().mockResolvedValue(d),
        update: jest
          .fn()
          .mockImplementation(({ data }) => (updates.push(data), Promise.resolve({}))),
      },
      notification: { count: jest.fn().mockResolvedValue(3) },
    };
    const mail = {
      send: jest
        .fn()
        .mockImplementation(() =>
          opts.mailFails ? Promise.reject(opts.mailFails) : Promise.resolve(),
        ),
    };
    const sms = { send: jest.fn().mockResolvedValue(undefined) };
    const gateway = { emitToUser: jest.fn() };
    const config = { get: () => 'http://localhost:3000/' };
    const sender = new NotificationSender(
      prisma as never,
      config as never,
      mail as never,
      sms as never,
      gateway as never,
    );
    return { sender, prisma, mail, sms, gateway, updates };
  };

  it('sends email with only the stored text and a section link, then records SENT', async () => {
    const t = make(delivery('EMAIL'));
    expect(await t.sender.deliver('d1')).toBe('sent');
    const m = t.mail.send.mock.calls[0][0];
    expect(m.to).toBe('pat@example.com');
    expect(m.text).toContain('http://localhost:3000/portal/lab-reports');
    expect(m.text).not.toMatch(/l1|n1|token/); // no ids or tokens in links (DEC-065)
    expect(t.updates[0]).toMatchObject({
      status: 'SENT',
      attempts: { increment: 1 },
      lastError: null,
    });
  });

  it('pushes in-app notifications and the unread count to the recipient room', async () => {
    const t = make(delivery('IN_APP'));
    await t.sender.deliver('d1');
    expect(t.gateway.emitToUser).toHaveBeenCalledWith(
      'u1',
      NOTIFICATION_SOCKET_EVENTS.created,
      expect.objectContaining({ id: 'n1' }),
    );
    expect(t.gateway.emitToUser).toHaveBeenCalledWith('u1', NOTIFICATION_SOCKET_EVENTS.unread, {
      unread: 3,
    });
  });

  it('never texts an unverified phone: the delivery fails at once without retry', async () => {
    const t = make(delivery('SMS', {}, recipient({ phoneVerifiedAt: null })));
    expect(await t.sender.deliver('d1')).toBe('failed');
    expect(t.sms.send).not.toHaveBeenCalled();
    expect(t.updates[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
  });

  it('does not deliver to an inactive account', async () => {
    const t = make(delivery('EMAIL', {}, recipient({ isActive: false })));
    expect(await t.sender.deliver('d1')).toBe('failed');
    expect(t.mail.send).not.toHaveBeenCalled();
  });

  it('keeps a transient failure PENDING and rethrows so the queue retries', async () => {
    const t = make(delivery('EMAIL'), { mailFails: new Error('SMTP unavailable') });
    await expect(t.sender.deliver('d1')).rejects.toThrow('SMTP unavailable');
    expect(t.updates[0]).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      lastError: 'SMTP unavailable',
    });
  });

  it(`marks FAILED on the last allowed attempt (${MAX_DELIVERY_ATTEMPTS}) and stops retrying`, async () => {
    const t = make(delivery('EMAIL', { attempts: MAX_DELIVERY_ATTEMPTS - 1 }), {
      mailFails: new Error('SMTP unavailable'),
    });
    expect(await t.sender.deliver('d1')).toBe('failed');
    expect(t.updates[0]).toMatchObject({ status: 'FAILED', attempts: MAX_DELIVERY_ATTEMPTS });
  });

  it('stores at most 300 characters of an error', async () => {
    const t = make(delivery('EMAIL'), { mailFails: new Error('x'.repeat(1000)) });
    await expect(t.sender.deliver('d1')).rejects.toThrow();
    expect(String(t.updates[0]?.lastError).length).toBe(300);
  });

  it.each(['SENT', 'FAILED'])(
    'skips a delivery that is already %s (no double send)',
    async (status) => {
      const t = make(delivery('EMAIL', { status }));
      expect(await t.sender.deliver('d1')).toBe('skipped');
      expect(t.mail.send).not.toHaveBeenCalled();
      expect(t.updates).toHaveLength(0);
    },
  );
});

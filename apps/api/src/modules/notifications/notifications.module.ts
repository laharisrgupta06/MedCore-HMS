import { Global, Module } from '@nestjs/common';
import { NotificationWriter } from './notification.writer';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Notification rows and the inbox API (Phase 9). Global, so business services can write
 * notifications inside their own transactions (NotificationWriter.stage). Delivery queues and the Socket.IO
 * gateway live in NotificationsDeliveryModule (application only), so tests need neither Redis nor
 * a WebSocket server; without it, rows are still written and deliveries stay PENDING.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationWriter],
  exports: [NotificationWriter],
})
export class NotificationsModule {}

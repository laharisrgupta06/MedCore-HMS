import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SessionStore } from '../../../common/auth/session.store';
import { TokenService } from '../../../common/auth/token.service';

export const userRoom = (userId: string) => `user:${userId}`;

/** How often a connected socket's session is checked again, so a revoked session is cut off. */
export const SESSION_RECHECK_MS = 60_000;

interface SocketAuth {
  userId: string;
  sessionId: string;
  exp?: number;
}

/**
 * Real-time notification pushes (DEC-062, TECH-024): Socket.IO on the API, one room per user.
 *
 * Authentication: the browser sends its in-memory access token only in the handshake `auth`
 * payload. A token in the URL or query string is refused, so it never reaches proxy or access logs.
 * The token is verified exactly like a request's Bearer token (signature, type, role claims) and
 * the Redis session must exist (logout, logout-all and password reset revoke it). A failed check
 * rejects the handshake (`connect_error`), so nothing is joined. While connected, the session is
 * checked again every minute and the socket is closed when the token expires; the client then
 * reconnects with its refreshed token.
 *
 * Transport: HTTP long-polling only, through the existing same-origin /api proxy (Next.js rewrites
 * do not carry WebSocket upgrades). No trailing slash on the path, so the proxy never redirects it.
 * Clients only listen: there are no inbound events, so nothing can be sent to another user's room.
 * One API instance; the Redis adapter is added when a second instance exists.
 */
@WebSocketGateway({
  path: '/api/socket.io',
  serveClient: false,
  transports: ['polling'],
  allowUpgrades: false,
  addTrailingSlash: false,
})
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('NotificationsGateway');
  @WebSocketServer() private server?: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionStore,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      void this.authenticate(socket).then(
        (auth) => {
          if (!auth) return next(new Error('UNAUTHENTICATED'));
          (socket.data as { auth?: SocketAuth }).auth = auth;
          next();
        },
        () => next(new Error('UNAUTHENTICATED')),
      );
    });
  }

  private async authenticate(socket: Socket): Promise<SocketAuth | null> {
    const q = socket.handshake.query as Record<string, unknown>;
    if ('token' in q || 'access_token' in q) return null;
    const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
    if (typeof token !== 'string' || !token) return null;
    const claims = await this.tokens.verifyAccess(token);
    if (!claims || !(await this.sessions.exists(claims.sub, claims.sid))) return null;
    return { userId: claims.sub, sessionId: claims.sid, exp: (claims as { exp?: number }).exp };
  }

  async handleConnection(socket: Socket): Promise<void> {
    const auth = (socket.data as { auth?: SocketAuth }).auth;
    if (!auth) {
      socket.disconnect(true);
      return;
    }
    await socket.join(userRoom(auth.userId));
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (typeof auth.exp === 'number')
      timers.push(
        setTimeout(() => socket.disconnect(true), Math.max(0, auth.exp * 1000 - Date.now())),
      );
    const recheck = setInterval(() => {
      void this.sessions.exists(auth.userId, auth.sessionId).then(
        (ok) => ok || socket.disconnect(true),
        () => undefined,
      );
    }, SESSION_RECHECK_MS);
    socket.once('disconnect', () => {
      timers.forEach(clearTimeout);
      clearInterval(recheck);
    });
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.log.warn(
        'Socket.IO server not ready; push skipped (the inbox still has the notification)',
      );
      return;
    }
    this.server.to(userRoom(userId)).emit(event, payload);
  }
}

export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  tls?: Record<string, never>;
}

/** Parses redis:// and rediss:// URLs into connection options (used by BullMQ). */
export function parseRedisUrl(url: string): RedisConnectionOptions {
  const u = new URL(url);
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') {
    throw new Error('Redis URL must use the redis:// or rediss:// scheme');
  }
  const dbPath = u.pathname.replace(/^\//, '');
  const db = dbPath === '' ? 0 : Number(dbPath);
  if (!Number.isInteger(db) || db < 0)
    throw new Error('Redis URL database index must be a non-negative integer');
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    db,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

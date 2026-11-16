/** Injection token for the shared ioredis client (sessions, caches, rate limiting). */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

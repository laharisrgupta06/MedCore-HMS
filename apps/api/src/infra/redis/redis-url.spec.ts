import { parseRedisUrl } from './redis-url';

describe('parseRedisUrl', () => {
  it('parses host, port and db', () => {
    expect(parseRedisUrl('redis://localhost:6380/2')).toEqual({
      host: 'localhost',
      port: 6380,
      db: 2,
    });
  });
  it('defaults port and db and decodes credentials', () => {
    expect(parseRedisUrl('rediss://default:p%40ss@cache.example.com')).toEqual({
      host: 'cache.example.com',
      port: 6379,
      username: 'default',
      password: 'p@ss',
      db: 0,
      tls: {},
    });
  });
  it('rejects other schemes and bad db indexes', () => {
    expect(() => parseRedisUrl('http://localhost')).toThrow(/scheme/);
    expect(() => parseRedisUrl('redis://localhost/abc')).toThrow(/database index/);
  });
});

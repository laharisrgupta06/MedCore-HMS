import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';

/** Phase 13: storage keys can never leave the storage folder, and stored files are never overwritten. */
describe('StorageService', () => {
  let root: string;
  let storage: StorageService;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'medcore-storage-'));
    storage = new StorageService({ get: () => root } as never);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('stores and reads a file under its key', async () => {
    await storage.put('h1/records/r1/a.pdf', Buffer.from('%PDF-1.4'));
    expect((await storage.get('h1/records/r1/a.pdf')).toString()).toBe('%PDF-1.4');
  });

  it.each(['../escape.pdf', 'h1/../../escape.pdf', '/etc/passwd', '..', ''])(
    'refuses the key %j',
    async (key) => {
      // get() refuses synchronously; put() and remove() reject. Either way nothing is touched.
      const attempt = (fn: () => unknown) => (async () => fn())();
      await expect(attempt(() => storage.put(key, Buffer.from('x')))).rejects.toThrow(
        'Invalid storage key',
      );
      await expect(attempt(() => storage.get(key))).rejects.toThrow('Invalid storage key');
      await expect(attempt(() => storage.remove(key))).rejects.toThrow('Invalid storage key');
    },
  );

  it('never overwrites an existing file', async () => {
    await storage.put('h1/a.pdf', Buffer.from('first'));
    await expect(storage.put('h1/a.pdf', Buffer.from('second'))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect((await storage.get('h1/a.pdf')).toString()).toBe('first');
  });
});

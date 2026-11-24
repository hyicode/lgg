import { createLocalClient, readLocalBackup, type StorageLike } from './localStore.ts';
import { createCloudClient, type CloudSession } from './cloudClient.ts';

// Choose once at startup. Switching requires a reload, which discards pending
// drafts and in-memory data. Never fall back to local writes after a cloud error.
export function createDataAccess(session: CloudSession | null, storage: StorageLike, fetcher: typeof fetch = fetch) {
  if (session) return createCloudClient(session, fetcher);
  return { ...createLocalClient(storage), readBackup: async () => readLocalBackup(storage) };
}
export function scopedStorage(storage: Storage, scope: string | null): Storage {
  const key = (name: string) => scope ? `lgg.cloud.${scope}.${name}` : name;
  return {
    get length() { return storage.length; },
    key: index => storage.key(index),
    getItem: name => storage.getItem(key(name)),
    setItem: (name, value) => storage.setItem(key(name), value),
    removeItem: name => storage.removeItem(key(name)),
    clear: () => { throw new Error('请逐项清理当前模式的数据。'); },
  };
}

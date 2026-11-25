import { createLocalClient, readLocalBackup, saveLocalBackup, validateBackup, type LocalBackup, type StorageLike } from './localStore.ts';
import { createCloudClient, type CloudSession } from './cloudClient.ts';

// Choose once at startup. Switching requires a reload, which discards pending
// drafts and in-memory data. Never fall back to local writes after a cloud error.
export function createDataAccess(session: CloudSession | null, storage: StorageLike, fetcher: typeof fetch = fetch) {
  if (session) {
    const cloud = createCloudClient(session, fetcher);
    // Serialize refreshes so a slower, older response cannot replace newer data.
    let pending: Promise<LocalBackup> | undefined;
    return {
      ...cloud,
      readBackup() {
        pending = (pending ?? Promise.resolve()).catch(() => undefined).then(async () => {
          const backup = validateBackup(await cloud.readBackup());
          // Replace the complete snapshot, including records deleted in D1.
          // Validation and storage failures leave the previous local copy intact.
          saveLocalBackup(backup, storage);
          return backup;
        });
        return pending;
      },
    };
  }
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

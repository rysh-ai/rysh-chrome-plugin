// storage.ts — Promise wrapper around chrome.storage.local

export const storage = {
  get(key: string): Promise<unknown> {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => {
        resolve(result[key] ?? null);
      });
    });
  },

  set(data: Record<string, unknown>): Promise<void> {
    return new Promise(resolve => chrome.storage.local.set(data, resolve));
  },

  remove(keys: string | string[]): Promise<void> {
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
  },

  clear(): Promise<void> {
    return new Promise(resolve => chrome.storage.local.clear(resolve));
  },
};

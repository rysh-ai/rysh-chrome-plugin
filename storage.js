// storage.js — Promise wrapper around chrome.storage.local

export const storage = {
  get(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => {
        resolve(typeof key === 'string' ? result[key] ?? null : result);
      });
    });
  },
  set(data) {
    return new Promise(resolve => chrome.storage.local.set(data, resolve));
  },
  remove(keys) {
    return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
  },
  clear() {
    return new Promise(resolve => chrome.storage.local.clear(resolve));
  },
};

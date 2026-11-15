// store.js: device storage (IndexedDB) and JSON backup/restore.
// Everything is loaded into memory at start and written through on change.

export const BACKUP_VERSION = 1;
const DB_NAME = 'wortkiste';
const STORES = ['kv', 'cards', 'revlog'];

// ---- Backends ----
export function memoryBackend() {
  const data = { kv: new Map(), cards: new Map(), revlog: new Map() };
  let seq = 0;
  return {
    async getAll(store) { return [...data[store].entries()]; },
    async put(store, key, value) { if (store === 'revlog' && key == null) key = ++seq; else if (store === 'revlog') seq = Math.max(seq, key); data[store].set(key, structuredClone(value)); return key; },
    async del(store, key) { data[store].delete(key); },
    async putMany(store, entries) { for (const [k, v] of entries) await this.put(store, k, v); },
    async clear() { for (const s of STORES) data[s].clear(); seq = 0; },
  };
}

export function idbBackend(name = DB_NAME) {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards');
      if (!db.objectStoreNames.contains('revlog')) db.createObjectStore('revlog', { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async getAll(store) {
      return tx([store], 'readonly', async (t) => {
        const os = t.objectStore(store);
        const [keys, vals] = await Promise.all([reqP(os.getAllKeys()), reqP(os.getAll())]);
        return keys.map((k, i) => [k, vals[i]]);
      });
    },
    async put(store, key, value) {
      return tx([store], 'readwrite', (t) => {
        const os = t.objectStore(store);
        return reqP(key == null ? os.put(value) : os.put(value, key));
      });
    },
    async del(store, key) { return tx([store], 'readwrite', (t) => reqP(t.objectStore(store).delete(key))); },
    async putMany(store, entries) {
      return tx([store], 'readwrite', (t) => {
        const os = t.objectStore(store);
        for (const [k, v] of entries) { if (k == null) os.put(v); else os.put(v, k); }
      });
    },
    async clear() { return tx(STORES, 'readwrite', (t) => Promise.all(STORES.map((s) => reqP(t.objectStore(s).clear())))); },
  };
}

// ---- Store ----
export async function createStore(backend) {
  const state = { kv: {}, cards: {}, revlog: [] };
  const load = async () => {
    state.kv = Object.fromEntries(await backend.getAll('kv'));
    state.cards = Object.fromEntries(await backend.getAll('cards'));
    state.revlog = (await backend.getAll('revlog')).sort((a, b) => a[0] - b[0]).map(([id, v]) => ({ ...v, id }));
  };
  await load();
  return {
    state,
    get: (key, fallback) => (key in state.kv ? state.kv[key] : fallback),
    async set(key, value) { state.kv[key] = value; await backend.put('kv', key, value); },
    card: (id) => state.cards[id],
    async putCard(id, st) { state.cards[id] = st; await backend.put('cards', id, st); },
    async delCard(id) { delete state.cards[id]; await backend.del('cards', id); },
    async addLog(entry) { const id = await backend.put('revlog', null, entry); state.revlog.push({ ...entry, id }); return id; },
    async delLog(id) { state.revlog = state.revlog.filter((e) => e.id !== id); await backend.del('revlog', id); },
    exportJSON() {
      return { app: 'wortkiste', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), kv: state.kv, cards: state.cards, revlog: state.revlog };
    },
    async reset() { await backend.clear(); state.kv = {}; state.cards = {}; state.revlog = []; },
    async importJSON(data) {
      if (!data || data.app !== 'wortkiste' || typeof data.cards !== 'object' || !Array.isArray(data.revlog)) {
        throw new Error('This file is not a Wortkiste backup.');
      }
      await backend.clear();
      await backend.putMany('kv', Object.entries(data.kv || {}));
      await backend.putMany('cards', Object.entries(data.cards));
      await backend.putMany('revlog', data.revlog.map(({ id, ...rest }) => [id ?? null, rest]));
      await load();
    },
  };
}

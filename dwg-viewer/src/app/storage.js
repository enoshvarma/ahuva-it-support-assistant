// IndexedDB storage for recent drawings (so they reopen offline) and markups.
const DB_NAME = 'dwg-viewer';
const MAX_FILES = 15;
const MAX_TOTAL = 400 * 1024 * 1024;

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('data')) d.createObjectStore('data');
      if (!d.objectStoreNames.contains('markups')) d.createObjectStore('markups');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function req2p(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function fileId(name, buffer) {
  // FNV-1a over size + sampled bytes: stable id for markups and the recent list
  const b = new Uint8Array(buffer);
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(b.length / 65536));
  for (let i = 0; i < b.length; i += step) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return `${b.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

export async function listRecent() {
  try {
    const all = await tx(['files'], 'readonly', (t) => req2p(t.objectStore('files').getAll()));
    return (all || []).sort((a, b) => b.opened - a.opened);
  } catch { return []; }
}

export async function saveRecent(meta, buffer) {
  try {
    const list = await listRecent();
    await tx(['files', 'data'], 'readwrite', (t) => {
      t.objectStore('files').put({ ...meta, opened: Date.now() });
      t.objectStore('data').put(buffer, meta.id);
      // evict oldest entries beyond the limits
      let total = meta.size;
      let count = 1;
      for (const f of list) {
        if (f.id === meta.id) continue;
        count++; total += f.size || 0;
        if (count > MAX_FILES || total > MAX_TOTAL) {
          t.objectStore('files').delete(f.id);
          t.objectStore('data').delete(f.id);
        }
      }
    });
  } catch (e) { console.warn('recent save failed', e); }
}

export async function updateRecent(id, patch) {
  try {
    await tx(['files'], 'readwrite', async (t) => {
      const s = t.objectStore('files');
      const cur = await req2p(s.get(id));
      if (cur) s.put({ ...cur, ...patch });
    });
  } catch { /* ignore */ }
}

export async function loadRecentData(id) {
  return tx(['data'], 'readonly', (t) => req2p(t.objectStore('data').get(id)));
}

export async function removeRecent(id) {
  await tx(['files', 'data', 'markups'], 'readwrite', (t) => {
    t.objectStore('files').delete(id);
    t.objectStore('data').delete(id);
    t.objectStore('markups').delete(id);
  });
}

export async function clearRecent() {
  await tx(['files', 'data'], 'readwrite', (t) => { t.objectStore('files').clear(); t.objectStore('data').clear(); });
}

export async function loadMarkups(id) {
  try { return (await tx(['markups'], 'readonly', (t) => req2p(t.objectStore('markups').get(id)))) || null; } catch { return null; }
}

export async function saveMarkups(id, data) {
  try { await tx(['markups'], 'readwrite', (t) => { t.objectStore('markups').put(data, id); }); } catch { /* ignore */ }
}

export function prefs() {
  try { return JSON.parse(localStorage.getItem('dwgv-prefs') || '{}'); } catch { return {}; }
}
export function setPref(k, v) {
  try { const p = prefs(); p[k] = v; localStorage.setItem('dwgv-prefs', JSON.stringify(p)); } catch { /* ignore */ }
}

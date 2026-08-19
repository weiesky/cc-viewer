const DB_NAME = 'ccv_entryCache';
const STORE_NAME = 'entries';
const CACHE_KEY = 'cache';
const META_KEY = 'ccv_cacheMeta';
const DB_VERSION = 2;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 天过期

// 单例 DB 连接，避免每次操作都重新打开
let _dbInstance = null;
let _dbPromise = null;

function getDB() {
  if (_dbInstance) return Promise.resolve(_dbInstance);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      _dbInstance = req.result;
      _dbInstance.onclose = () => { _dbInstance = null; };
      _dbPromise = null;
      resolve(_dbInstance);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });
  return _dbPromise;
}

// 写入序列化：丢弃排队中的过时写入，只保留最新一次
let _writeId = 0;

function saveMeta(projectName, entries) {
  try {
    const last = entries[entries.length - 1];
    const lastTs = last?.timestamp || null;
    if (lastTs) {
      localStorage.setItem(META_KEY, JSON.stringify({ projectName, lastTs, count: entries.length }));
    }
  } catch {
    // 静默
  }
}

function clearMeta() {
  try {
    localStorage.removeItem(META_KEY);
  } catch {
    // 静默
  }
}

/**
 * 同步读取缓存元数据（用于 initSSE 构造增量请求参数）
 * @returns {{ projectName: string, lastTs: string, count: number } | null}
 */
export function getCacheMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    if (meta?.lastTs && meta?.count > 0 && meta?.projectName) return meta;
    return null;
  } catch {
    return null;
  }
}

// Wire v3 (V3.S3a): persisted-record protocol gate. NOT a DB_VERSION bump —
// a version bump wipes every user's cache at upgrade time regardless of the
// CCV_WIRE_V3 flag (breaking the dark launch); tagging records instead means
// only a genuine flag-state skew between save and load invalidates.
const PROTOCOL_VERSION = 1;

export async function saveEntries(projectName, entries) {
  if (!projectName || !Array.isArray(entries) || entries.length === 0) return;
  const myId = ++_writeId;
  try {
    const db = await getDB();
    // 被更新的写入请求取代，丢弃本次
    if (myId !== _writeId) return;
    saveMeta(projectName, entries);
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ projectName, entries, ts: Date.now(), protocolVersion: PROTOCOL_VERSION }, CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 静默
  }
}

export async function loadEntries(projectName) {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
      req.onsuccess = () => {
        const data = req.result;
        if (!data || data.projectName !== projectName || !Array.isArray(data.entries) || data.entries.length === 0) {
          resolve(null);
        } else if ((data.protocolVersion || 0) > PROTOCOL_VERSION) {
          // Written by a newer client shape than this build understands.
          clearEntries();
          resolve(null);
        } else if (data.ts && Date.now() - data.ts > MAX_AGE) {
          // 缓存超过 7 天，清除并返回 null
          clearEntries();
          resolve(null);
        } else {
          resolve(data.entries);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function clearEntries() {
  clearMeta();
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 静默
  }
}


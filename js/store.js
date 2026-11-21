// Everything lives on the device in localStorage.
//   upnext.v1        -> { shows, watched, activity }  (your data — this is what export saves)
//   upnext.eps.<id>  -> { at, eps }                   (episode cache, re-downloadable)
const KEY = 'upnext.v1';
const EPS = 'upnext.eps.';
export const FRESH_MS = 12 * 3600 * 1000;

const blank = () => ({ v: 1, shows: {}, watched: {}, activity: {} });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s.shows === 'object') return Object.assign(blank(), s);
  } catch (e) { /* corrupted — start fresh */ }
  return blank();
}

export const state = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Could not save', e); }
}

// ---- episode cache ----
const mem = new Map();

export function getCachedEps(id) {
  id = String(id);
  if (mem.has(id)) return mem.get(id);
  try {
    const c = JSON.parse(localStorage.getItem(EPS + id));
    if (c && Array.isArray(c.eps)) { mem.set(id, c); return c; }
  } catch (e) { /* ignore */ }
  return null;
}

function write(id, c) {
  try { localStorage.setItem(EPS + id, JSON.stringify(c)); }
  catch (e) {
    prune();
    try { localStorage.setItem(EPS + id, JSON.stringify(c)); } catch (e2) { /* memory only */ }
  }
}

export function setCachedEps(id, eps, persist) {
  id = String(id);
  const c = { at: Date.now(), eps };
  mem.set(id, c);
  if (persist) write(id, c);
}

export function persistEps(id) {
  id = String(id);
  const c = mem.get(id);
  if (c) write(id, c);
}

export function unpersistEps(id) {
  localStorage.removeItem(EPS + String(id));
}

function prune() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(EPS) && !state.shows[k.slice(EPS.length)]) localStorage.removeItem(k);
  }
}

// ---- watched ----
export function isWatched(sid, eid) {
  return !!state.watched[sid]?.[eid];
}

export function setWatched(sid, eids, val) {
  const map = state.watched[sid] || (state.watched[sid] = {});
  const t = Date.now();
  for (const id of eids) {
    if (val) { if (!map[id]) map[id] = t; }
    else delete map[id];
  }
  if (!Object.keys(map).length) delete state.watched[sid];
  state.activity[sid] = t;
}

// ---- backup ----
export function exportData() {
  return JSON.stringify({ app: 'up-next', exported: new Date().toISOString(), ...state }, null, 1);
}

export function importData(text) {
  const d = JSON.parse(text);
  if (!d || typeof d.shows !== 'object' || typeof d.watched !== 'object') {
    throw new Error("That file doesn't look like an Up Next backup");
  }
  state.shows = d.shows;
  state.watched = d.watched;
  state.activity = d.activity || {};
  save();
}

export function clearAll() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k === KEY || k.startsWith(EPS))) localStorage.removeItem(k);
  }
  mem.clear();
  Object.assign(state, blank());
}

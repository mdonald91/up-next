// Everything lives on the device in localStorage (and optionally a private GitHub Gist, see sync.js).
//   upnext.v1        -> your data: { shows, watched, activity, history, tomb }
//   upnext.eps.<id>  -> episode cache (re-downloadable)
//
// Sync-friendly bookkeeping:
//   shows[id].mtime        when you last changed that show (add / list change)
//   watched[sid][eid] = t  when you ticked the episode
//   tomb[key] = t          when something was deleted ("show:<id>" or "<sid>:<eid>"), so a
//                          merge with another device doesn't bring it back
//   history[sid] = [{ start, end, eps: { eid: t } }]  finished watch-throughs (rewatches)
const KEY = 'upnext.v1';
const EPS = 'upnext.eps.';
const DISC = 'upnext.disc';
export const FRESH_MS = 12 * 3600 * 1000;
const TOMB_TTL = 120 * 24 * 3600 * 1000;

const blank = () => ({ v: 2, shows: {}, watched: {}, activity: {}, history: {}, tomb: {} });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s.shows === 'object') {
      const out = Object.assign(blank(), s);
      for (const k of ['watched', 'activity', 'history', 'tomb']) if (!out[k] || typeof out[k] !== 'object') out[k] = {};
      return out;
    }
  } catch (e) { /* corrupted — start fresh */ }
  return blank();
}

export const state = load();

let onSave = null;
export function setOnSave(fn) { onSave = fn; }

export function save(quiet) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) {
    // Out of space: drop re-downloadable caches and try again
    prune(true);
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e2) { console.warn('Could not save', e2); }
  }
  if (onSave && !quiet) onSave();
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
    prune(true);
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
  const c = mem.get(String(id));
  if (c) write(String(id), c);
}

export function unpersistEps(id) {
  localStorage.removeItem(EPS + String(id));
}

function prune(alsoDiscover) {
  if (alsoDiscover) localStorage.removeItem(DISC);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(EPS) && !state.shows[k.slice(EPS.length)]) localStorage.removeItem(k);
  }
}

// ---- edits ----
export function touch(sid) {
  if (state.shows[sid]) state.shows[sid].mtime = Date.now();
}

export function isWatched(sid, eid) {
  return !!state.watched[sid]?.[eid];
}

export function setWatched(sid, eids, val, when) {
  const map = state.watched[sid] || (state.watched[sid] = {});
  const t = when || Date.now();
  for (const id of eids) {
    const k = `${sid}:${id}`;
    if (val) {
      if (!map[id]) map[id] = state.tomb[k] && state.tomb[k] >= t ? Date.now() : t;
      delete state.tomb[k];
    }
    else if (map[id]) { delete map[id]; state.tomb[k] = Date.now(); }
  }
  if (!Object.keys(map).length) delete state.watched[sid];
  state.activity[sid] = Date.now();
}

export function removeShowData(sid) {
  delete state.shows[sid];
  delete state.watched[sid];
  delete state.activity[sid];
  delete state.history[sid];
  for (const k of Object.keys(state.tomb)) if (k.startsWith(`${sid}:`)) delete state.tomb[k];
  state.tomb[`show:${sid}`] = Date.now();
  unpersistEps(sid);
}

// Moves the current watch-through into history and clears the ticks for a fresh run.
export function dropRun(sid, start) {
  state.tomb[`run:${sid}:${start}`] = Date.now();
}

export function startRewatch(sid) {
  const w = state.watched[sid];
  if (!w || !Object.keys(w).length) return false;
  const times = Object.values(w);
  (state.history[sid] || (state.history[sid] = [])).push({ start: Math.min(...times), end: Math.max(...times), eps: { ...w } });
  setWatched(sid, Object.keys(w), false);
  const s = state.shows[sid];
  if (s) { s.rewatch = (s.rewatch || 0) + 1; s.list = 'watching'; s.mtime = Date.now(); }
  return true;
}

// ---- merge (used by sync) ----
const showTime = (s) => (s ? s.mtime || s.addedAt || 0 : 0);

export function mergeRemote(r) {
  if (!r || typeof r.shows !== 'object' || typeof r.watched !== 'object') return false;
  const before = JSON.stringify(state);
  const now = Date.now();

  const tomb = { ...(r.tomb || {}) };
  for (const [k, t] of Object.entries(state.tomb)) tomb[k] = Math.max(t, tomb[k] || 0);
  for (const [k, t] of Object.entries(tomb)) if (now - t > TOMB_TTL) delete tomb[k];

  const shows = {};
  for (const id of new Set([...Object.keys(state.shows), ...Object.keys(r.shows)])) {
    const a = state.shows[id], b = r.shows[id];
    let s = !a ? b : !b ? a : (showTime(b) > showTime(a) ? { ...a, ...b } : { ...b, ...a });
    if (s && showTime(s) < (tomb[`show:${id}`] || 0)) s = null;
    if (s) shows[id] = s;
  }

  const watched = {};
  for (const sid of new Set([...Object.keys(state.watched), ...Object.keys(r.watched)])) {
    if (!shows[sid]) continue;
    const a = state.watched[sid] || {}, b = r.watched[sid] || {};
    const out = {};
    for (const eid of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const t = Math.max(a[eid] || 0, b[eid] || 0);
      if (t > (tomb[`${sid}:${eid}`] || 0)) out[eid] = t;
    }
    if (Object.keys(out).length) watched[sid] = out;
  }

  const activity = {};
  for (const sid of Object.keys(shows)) {
    const t = Math.max(state.activity[sid] || 0, r.activity?.[sid] || 0);
    if (t) activity[sid] = t;
  }

  const history = {};
  for (const sid of Object.keys(shows)) {
    const runs = new Map();
    for (const run of [...(state.history[sid] || []), ...(r.history?.[sid] || [])]) {
      if (!tomb[`run:${sid}:${run.start}`]) runs.set(run.start, run);
    }
    if (runs.size) history[sid] = [...runs.values()].sort((x, y) => x.start - y.start);
  }

  Object.assign(state, { shows, watched, activity, history, tomb });
  const changed = JSON.stringify(state) !== before;
  if (changed) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  return changed;
}

// ---- backup ----
export function syncPayload() {
  const { shows, watched, activity, history, tomb } = state;
  return { app: 'up-next', v: 2, shows, watched, activity, history, tomb };
}

export function exportData() {
  return JSON.stringify({ ...syncPayload(), exported: new Date().toISOString() }, null, 1);
}

export function importData(text) {
  const d = JSON.parse(text);
  if (!d || typeof d.shows !== 'object' || typeof d.watched !== 'object') {
    throw new Error("That file doesn't look like an Up Next backup");
  }
  const now = Date.now();
  // Anything on this device that isn't in the backup counts as deleted, so sync agrees.
  for (const id of Object.keys(state.shows)) if (!d.shows[id]) state.tomb[`show:${id}`] = now;
  for (const [sid, eps] of Object.entries(state.watched)) {
    for (const eid of Object.keys(eps)) if (!d.watched[sid]?.[eid]) state.tomb[`${sid}:${eid}`] = now;
  }
  state.shows = d.shows;
  for (const s of Object.values(state.shows)) s.mtime = now;
  state.watched = d.watched;
  state.activity = d.activity || {};
  state.history = d.history || {};
  save();
}

export function clearAll() {
  const now = Date.now();
  const tomb = {};
  for (const id of Object.keys(state.shows)) tomb[`show:${id}`] = now;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(EPS)) localStorage.removeItem(k);
  }
  mem.clear();
  Object.assign(state, blank(), { tomb });
  save();
}

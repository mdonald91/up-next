// Optional sync through a private GitHub Gist.
// You paste a GitHub token that can only touch gists; the app keeps one private gist
// ("up-next.json") and merges it with this device whenever something changes.
import { mergeRemote, syncPayload } from './store.js';

const CFG = 'upnext.sync';
const FILE = 'up-next.json';
const GH = 'https://api.github.com';

let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(CFG)); } catch (e) { cfg = null; }

export const sync = { busy: false, error: null, onChange: null, onStatus: null };

export const isConnected = () => !!(cfg && cfg.token && cfg.gist);
export const lastSynced = () => (cfg && cfg.last) || 0;
export const syncUser = () => (cfg && cfg.user) || '';

function persist() {
  if (cfg) localStorage.setItem(CFG, JSON.stringify(cfg));
  else localStorage.removeItem(CFG);
}

async function gh(path, opts = {}, token = cfg?.token) {
  const res = await fetch(GH + path, {
    ...opts,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token. Check it was copied fully and has gist access.');
  if (res.status === 404) throw new Error('Sync gist not found. Try disconnecting and connecting again.');
  if (!res.ok) throw new Error(`GitHub error ${res.status}`);
  return res.json();
}

const payload = () => JSON.stringify(syncPayload());

export async function connect(token) {
  token = token.trim();
  if (!token) throw new Error('Paste your token first');
  const user = await gh('/user', {}, token).catch(() => null);
  let gist = null;
  for (let page = 1; page <= 10 && !gist; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`, {}, token);
    gist = list.find((g) => g.files && g.files[FILE]);
    if (list.length < 100) break;
  }
  if (!gist) {
    gist = await gh('/gists', {
      method: 'POST',
      body: JSON.stringify({ description: 'Up Next — TV tracker sync (private)', public: false, files: { [FILE]: { content: payload() } } }),
    }, token);
  }
  cfg = { token, gist: gist.id, user: user?.login || '', last: 0 };
  persist();
  await syncNow();
  if (sync.error) throw new Error(sync.error);
}

export function disconnect() {
  cfg = null;
  persist();
  sync.error = null;
  status();
}

async function pull() {
  const g = await gh(`/gists/${cfg.gist}`);
  const f = g.files?.[FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
  try { return JSON.parse(text); } catch (e) { return null; }
}

async function push(body) {
  await gh(`/gists/${cfg.gist}`, { method: 'PATCH', body: JSON.stringify({ files: { [FILE]: { content: body } } }) });
}

const status = () => sync.onStatus && sync.onStatus();

let running = null;
let again = false;
export function syncNow() {
  if (!isConnected()) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    sync.busy = true; status();
    try {
      const remote = await pull();
      const changed = remote ? mergeRemote(remote) : false;
      const mine = payload();
      if (!remote || JSON.stringify({ ...remote, app: 'up-next', v: 2 }) !== mine) await push(mine);
      cfg.last = Date.now();
      persist();
      sync.error = null;
      if (changed && sync.onChange) sync.onChange();
    } catch (e) {
      sync.error = navigator.onLine === false ? 'Offline — will sync when you reconnect' : (e.message || 'Sync failed');
    } finally {
      sync.busy = false;
      running = null;
      status();
      if (again) { again = false; schedule(); }
    }
  })();
  return running;
}

let timer;
export function schedule(delay = 2500) {
  if (!isConnected()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

window.addEventListener('online', () => schedule(500));

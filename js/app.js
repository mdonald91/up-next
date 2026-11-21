import {
  state, save, getCachedEps, setCachedEps, persistEps, unpersistEps, FRESH_MS,
  isWatched, setWatched, exportData, importData, clearAll,
} from './store.js';
import { searchShows, fetchShow, fetchCast, fetchSchedule } from './api.js';

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const code = (e) => `S${pad(e.s)}E${pad(e.n)}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const DAY = 864e5;
const airTime = (e) => (e.stamp ? Date.parse(e.stamp) : e.date ? Date.parse(e.date + 'T12:00:00') : NaN);
const isAired = (e) => { const t = airTime(e); return !isNaN(t) && t <= Date.now(); };
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const year = (d) => (d ? d.slice(0, 4) : '');

function fmtDate(t, withYear) {
  if (isNaN(t)) return 'TBA';
  const d = new Date(t);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (withYear || d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function relDay(t) {
  const diff = Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return new Date(t).toLocaleDateString(undefined, { weekday: 'long' });
  return fmtDate(t);
}

function poster(img, name, cls = 'poster') {
  return img
    ? `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy">`
    : `<div class="${cls} ph">${esc((name || '?').slice(0, 2))}</div>`;
}

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
};

// ---------- show data ----------
const tempShows = new Map(); // info for shows you're browsing but haven't added
const inflight = new Map();

const showInfo = (id) => state.shows[id] || tempShows.get(String(id));
const isTracked = (id) => !!state.shows[id];

async function loadShow(id, force = false) {
  id = String(id);
  const cached = getCachedEps(id);
  if (!force && cached && showInfo(id) && Date.now() - cached.at < FRESH_MS) return cached.eps;
  if (inflight.has(id)) return inflight.get(id);
  const p = fetchShow(id)
    .then((res) => {
      if (!res) throw new Error("Couldn't find that show");
      if (state.shows[id]) {
        const { list, addedAt } = state.shows[id];
        state.shows[id] = { ...res.show, list, addedAt };
        save();
      } else tempShows.set(id, res.show);
      setCachedEps(id, res.eps, isTracked(id));
      return res.eps;
    })
    .catch((err) => { if (cached && showInfo(id)) return cached.eps; throw err; })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

function summary(id) {
  const c = getCachedEps(id);
  const eps = c ? c.eps : [];
  const w = state.watched[id] || {};
  let aired = 0, watchedAired = 0, watched = 0, next = null, upcoming = null;
  for (const e of eps) {
    const ww = !!w[e.id];
    if (ww) watched++;
    if (isAired(e)) {
      aired++;
      if (ww) watchedAired++;
      else if (!next) next = e;
    } else if (!upcoming && !isNaN(airTime(e))) upcoming = e;
  }
  return { loaded: !!c, eps, aired, watched, left: aired - watchedAired, next, upcoming };
}

function category(id) {
  const s = state.shows[id];
  if (s.list === 'stopped') return 'stopped';
  if (s.list === 'plan') return 'plan';
  const sm = summary(id);
  if (sm.loaded && sm.aired > 0 && sm.left === 0) return s.status === 'Ended' ? 'completed' : 'caught';
  return 'watching';
}

// ---------- actions ----------
function snapshot(sid) {
  const snap = JSON.stringify({ w: state.watched[sid] || null, s: state.shows[sid] || null, a: state.activity[sid] || null });
  return () => {
    const o = JSON.parse(snap);
    if (o.w) state.watched[sid] = o.w; else delete state.watched[sid];
    if (o.s) state.shows[sid] = o.s; else { delete state.shows[sid]; unpersistEps(sid); }
    if (o.a) state.activity[sid] = o.a; else delete state.activity[sid];
    save(); rerender();
  };
}

function track(sid, list) {
  const info = showInfo(sid);
  if (!info) return;
  if (!state.shows[sid]) {
    state.shows[sid] = { ...info, list, addedAt: Date.now() };
    tempShows.delete(sid);
    persistEps(sid);
  } else state.shows[sid].list = list;
  if (!state.activity[sid]) state.activity[sid] = Date.now();
}

function markEps(sid, eps, val, msg) {
  const undo = snapshot(sid);
  if (val) {
    if (!isTracked(sid)) track(sid, 'watching');
    else if (state.shows[sid].list !== 'watching') state.shows[sid].list = 'watching';
  }
  setWatched(sid, eps.map((e) => e.id), val);
  save();
  rerender();
  toast(msg || (val ? (eps.length === 1 ? `${code(eps[0])} watched` : `${eps.length} episodes watched`) : 'Marked unwatched'), undo);
}

function toggleEp(sid, eid) {
  const c = getCachedEps(sid);
  if (!c) return;
  const ep = c.eps.find((x) => x.id === eid);
  if (!ep) return;
  if (isWatched(sid, eid)) { markEps(sid, [ep], false); return; }
  const key = (x) => x.s * 10000 + x.n;
  const earlier = c.eps.filter((x) => key(x) < key(ep) && isAired(x) && !isWatched(sid, x.id));
  if (!earlier.length) { markEps(sid, [ep], true); return; }
  sheet(`You haven't ticked off ${plural(earlier.length, 'earlier episode')}. Mark ${earlier.length === 1 ? 'it' : 'them'} as watched too?`, [
    { label: `Yes, mark all ${earlier.length + 1}`, primary: true, fn: () => markEps(sid, [...earlier, ep], true) },
    { label: 'Just this one', fn: () => markEps(sid, [ep], true) },
  ]);
}

function toggleSeason(sid, season) {
  const c = getCachedEps(sid);
  const eps = c.eps.filter((e) => e.s === season && isAired(e));
  if (!eps.length) return;
  const allDone = eps.every((e) => isWatched(sid, e.id));
  if (allDone) markEps(sid, eps, false, `Season ${season} unmarked`);
  else markEps(sid, eps.filter((e) => !isWatched(sid, e.id)), true, `Season ${season} watched`);
}

function removeShow(sid) {
  const s = state.shows[sid];
  sheet(`Remove ${s.name} and its watch history?`, [
    {
      label: 'Remove show', danger: true, fn: () => {
        const undo = snapshot(sid);
        tempShows.set(sid, s);
        delete state.shows[sid];
        delete state.watched[sid];
        delete state.activity[sid];
        unpersistEps(sid);
        save(); rerender();
        toast(`${s.name} removed`, undo);
      },
    },
  ]);
}

// ---------- UI: toast & sheet ----------
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Undo</button>' : ''}`;
  el.hidden = false;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  if (undo) el.querySelector('button').onclick = () => { el.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

function sheet(title, buttons) {
  const el = $('#sheet');
  el.innerHTML = `<div class="sheet-bg" data-close></div>
    <div class="sheet-card" role="dialog" aria-modal="true">
      <p>${esc(title)}</p>
      ${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}
      <button class="btn ghost" data-close>Cancel</button>
    </div>`;
  el.hidden = false;
  el.onclick = (ev) => {
    const t = ev.target.closest('[data-i],[data-close]');
    if (!t) return;
    el.hidden = true;
    if (t.dataset.i != null) buttons[+t.dataset.i].fn();
  };
}

// ---------- routing ----------
let current = { name: 'next', arg: null };
let token = 0;
const TITLES = { next: 'Up Next', upcoming: 'Upcoming', discover: 'Discover', shows: 'My Shows', stats: 'Stats', search: 'Search' };

function parse() {
  const [, name, arg] = location.hash.split('/');
  return { name: TITLES[name] || name === 'show' ? name : 'next', arg: arg ? decodeURIComponent(arg) : null };
}

function route() {
  current = parse();
  token++;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === current.name));
  const top = ['next', 'upcoming', 'discover', 'shows', 'stats'].includes(current.name);
  $('.back').hidden = top;
  $('#search-btn').hidden = current.name === 'search';
  $('#title').textContent = TITLES[current.name] || '';
  document.body.dataset.view = current.name;
  window.scrollTo(0, 0);
  render();
}

function render() {
  const r = { next: renderNext, upcoming: renderUpcoming, discover: renderDiscover, shows: renderShows, stats: renderStats, search: renderSearch, show: renderShow }[current.name];
  r(current.arg);
}

let rerenderQueued = false;
function rerender() {
  if (rerenderQueued) return;
  rerenderQueued = true;
  requestAnimationFrame(() => {
    rerenderQueued = false;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  });
}

// ---------- view: Up Next ----------
function renderNext() {
  const ids = Object.keys(state.shows);
  if (!ids.length) {
    view.innerHTML = empty('Nothing to watch yet', 'Search for shows you watch and tick off episodes as you go.', '#/search', 'Find a show');
    return;
  }
  const items = [];
  let pending = 0;
  for (const id of ids) {
    const s = state.shows[id];
    if (s.list !== 'watching') continue;
    const sm = summary(id);
    if (!sm.loaded) { pending++; continue; }
    if (sm.next) items.push({ id, s, sm });
  }
  items.sort((a, b) => (state.activity[b.id] || 0) - (state.activity[a.id] || 0));

  let html = items.map(({ id, s, sm }) => {
    const e = sm.next;
    const started = sm.watched > 0;
    return `<article class="card" data-action="open" data-show="${id}">
      ${poster(s.img, s.name)}
      <div class="card-body">
        <div class="card-show">${esc(s.name)}</div>
        <div class="card-ep"><b>${code(e)}</b> ${esc(e.name)}</div>
        <div class="card-meta">${started ? `${plural(sm.left, 'episode')} left` : 'Not started'} · ${esc(fmtDate(airTime(e)))}</div>
        <div class="bar"><i style="width:${sm.aired ? Math.round(((sm.aired - sm.left) / sm.aired) * 100) : 0}%"></i></div>
      </div>
      <button class="tick" data-action="ep" data-show="${id}" data-ep="${e.id}" aria-label="Mark ${code(e)} watched">${ICON.check}</button>
    </article>`;
  }).join('');

  if (pending) html += `<p class="muted center pad">Loading ${plural(pending, 'show')}…</p>`;
  if (!items.length && !pending) {
    html = empty("You're all caught up 🎉", 'New episodes of your shows will show up here once they air.', '#/upcoming', "See what's coming");
  }
  view.innerHTML = `<div class="list">${html}</div>`;
}

function empty(title, text, href, cta) {
  return `<div class="empty"><div class="empty-art">📺</div><h2>${title}</h2><p>${text}</p>${href ? `<a class="btn primary" href="${href}">${cta}</a>` : ''}</div>`;
}

// ---------- view: Upcoming ----------
function renderUpcoming() {
  const start = startOfDay(Date.now());
  const items = [];
  for (const id in state.shows) {
    const s = state.shows[id];
    if (s.list === 'stopped') continue;
    const c = getCachedEps(id);
    if (!c) continue;
    for (const e of c.eps) {
      const t = airTime(e);
      if (t >= start) items.push({ id, s, e, t });
    }
  }
  items.sort((a, b) => a.t - b.t);
  if (!items.length) {
    view.innerHTML = empty('No upcoming episodes', Object.keys(state.shows).length ? "None of your shows have announced new episodes yet." : 'Add some shows and their air dates will appear here.', Object.keys(state.shows).length ? null : '#/search', 'Find a show');
    return;
  }
  let html = '', lastDay = null;
  for (const { id, s, e, t } of items.slice(0, 250)) {
    const day = startOfDay(t);
    if (day !== lastDay) {
      const label = relDay(t), full = fmtDate(t);
      html += `<h3 class="day">${esc(label)}${label !== full ? `<span>${esc(full)}</span>` : ''}</h3>`;
      lastDay = day;
    }
    const w = isWatched(id, e.id);
    html += `<article class="row" data-action="open" data-show="${id}">
      ${poster(s.img, s.name, 'thumb')}
      <div class="row-body">
        <div class="row-title">${esc(s.name)} ${e.n === 1 ? `<span class="badge">${e.s === 1 ? 'Series premiere' : 'Season premiere'}</span>` : ''}</div>
        <div class="row-sub"><b>${code(e)}</b> ${esc(e.name)}</div>
      </div>
      <div class="row-side">${e.stamp ? esc(fmtTime(t)) : ''}<small>${esc(s.network)}</small>${w ? `<span class="done">${ICON.check}</span>` : ''}</div>
    </article>`;
  }
  view.innerHTML = `<div class="list">${html}</div>`;
}

// ---------- view: Discover ----------
// Built from TVmaze's daily schedules (TV for one region + all streaming services),
// over a window of 7 days back to 14 days ahead. Cached for 6 hours.
const DISC_KEY = 'upnext.disc';
const DISC_TTL = 6 * 3600 * 1000;
const REGIONS = [['US', 'US'], ['AU', 'Australia'], ['GB', 'UK'], ['CA', 'Canada'], ['JP', 'Japan'], ['KR', 'Korea'], ['CN', 'China']];
const LANGS = [['any', 'Any language'], ['English', 'English'], ['Japanese', 'Japanese'], ['Korean', 'Korean'], ['Chinese', 'Chinese']];
const REGION_LANG = { US: 'English', AU: 'English', GB: 'English', CA: 'English', JP: 'Japanese', KR: 'Korean', CN: 'Chinese' };
const TYPES = [['all', 'All'], ['anime', 'Anime'], ['Scripted', 'Drama & Comedy'], ['Animation', 'Animation'], ['Reality', 'Reality'], ['Documentary', 'Docs']];
const SKIP_TYPES = new Set(['News', 'Sports', 'Talk Show', 'Award Show']);
const disc = {
  region: localStorage.getItem('upnext.region') || 'US',
  lang: localStorage.getItem('upnext.lang') || (localStorage.getItem('upnext.english') === '0' ? 'any' : 'English'),
  type: 'all',
  data: null,
  partial: null,
  job: null,
  done: 0,
  total: 0,
};

function isoDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadDiscover(force) {
  const region = disc.region;
  const fresh = (d) => d && d.region === region && Date.now() - d.at < DISC_TTL;
  if (!force && fresh(disc.data)) return;
  if (!force && !disc.data) {
    try {
      const c = JSON.parse(localStorage.getItem(DISC_KEY));
      if (fresh(c)) { disc.data = c; return; }
    } catch (e) { /* ignore */ }
  }
  if (!force && disc.job && disc.job.region === region) return;

  const job = { region };
  disc.job = job;
  const data = { region, at: Date.now(), shows: {}, eps: [] };
  const seen = new Set();
  disc.partial = data;
  if (disc.data && disc.data.region !== region) disc.data = null;

  const offsets = [0];
  for (let i = 1; i <= 14; i++) offsets.push(i);
  for (let i = 1; i <= 7; i++) offsets.push(-i);
  const tasks = offsets.flatMap((o) => [[isoDay(o), region], [isoDay(o), null]]);
  disc.done = 0;
  disc.total = tasks.length;

  let last = 0;
  const tick = () => {
    if (current.name !== 'discover' || Date.now() - last < 1200) return;
    last = Date.now();
    rerender();
  };

  Promise.all(tasks.map(([date, country]) => fetchSchedule(date, country)
    .then((list) => {
      if (disc.job !== job) return;
      for (const x of list) {
        if (SKIP_TYPES.has(x.show.type)) continue;
        const key = `${x.show.id}|${x.s}|${x.n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!data.shows[x.show.id]) data.shows[x.show.id] = x.show;
        data.eps.push([x.show.id, x.s, x.n, x.t]);
      }
    })
    .catch(() => {})
    .finally(() => { if (disc.job === job) { disc.done++; tick(); } })))
    .then(() => {
      if (disc.job !== job) return;
      disc.job = null;
      disc.partial = null;
      data.at = Date.now();
      disc.data = data;
      try { localStorage.setItem(DISC_KEY, JSON.stringify(data)); } catch (e) { /* too big — memory only */ }
      if (current.name === 'discover') rerender();
    });
}

function discoverSections(d) {
  const today = startOfDay(Date.now());
  // TVmaze sometimes leaves language blank, so also reject titles in non-Latin scripts.
  const latin = (t) => !/[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF\u2100-\u214F]/.test(t);
  const isAnime = (s) => (s.genres || []).includes('Anime') || (s.type === 'Animation' && s.language === 'Japanese');
  const langOk = (s) => {
    if (disc.lang === 'any' || disc.type === 'anime') return true; // anime is Japanese by definition
    if (disc.lang === 'English') return (!s.language || s.language === 'English') && latin(s.name);
    if (disc.lang === 'Chinese') return ['Chinese', 'Mandarin', 'Cantonese'].includes(s.language);
    return s.language === disc.lang;
  };
  const typeOk = (s) => disc.type === 'all' || (disc.type === 'anime' ? isAnime(s) : s.type === disc.type);
  const ok = (s) => typeOk(s) && langOk(s);
  const popular = new Map(), onToday = new Map(), soon = new Map(), just = new Map(), back = new Map();
  const keep = (map, id, item) => { const prev = map.get(id); if (!prev || item.t < prev.t) map.set(id, item); };

  for (const [id, s, n, t] of d.eps) {
    const sh = d.shows[id];
    if (!sh || !ok(sh)) continue;
    const tm = t.length === 10 ? Date.parse(t + 'T12:00:00') : Date.parse(t);
    if (isNaN(tm)) continue;
    const day = startOfDay(tm);
    if (Math.abs(day - today) <= 3 * DAY) popular.set(id, { sh, t: tm });
    if (day === today) keep(onToday, id, { sh, t: tm, stamp: t.length > 10 });
    if (n === 1) {
      if (s === 1) keep(day >= today ? soon : just, id, { sh, t: tm });
      else if (s < 1900 && day >= today - 3 * DAY) keep(back, id, { sh, t: tm, s }); // skip yearly specials ("Season 2026")
    }
  }
  for (const id of soon.keys()) just.delete(id);
  const top = (map, n = 30) => [...map.values()].sort((a, b) => (b.sh.weight || 0) - (a.sh.weight || 0) || a.t - b.t).slice(0, n);
  return {
    popular: top(popular),
    soon: top(soon),
    just: top(just),
    back: top(back),
    today: top(onToday, 40),
  };
}

function discCard(sh, label) {
  const on = isTracked(sh.id);
  return `<div class="dcard" data-action="open" data-show="${sh.id}">
    <div class="tile-img">${poster(sh.img, sh.name)}
      <button class="dadd ${on ? 'on' : ''}" data-action="${on ? 'open' : 'quick-add'}" data-show="${sh.id}" aria-label="${on ? 'Added' : 'Add'} ${esc(sh.name)}">${on ? ICON.check : ICON.plus}</button>
    </div>
    <div class="tile-name">${esc(sh.name)}</div>
    <div class="dsub">${esc(label)}</div>
  </div>`;
}

function renderDiscover() {
  loadDiscover(false);
  const scrolls = {};
  view.querySelectorAll('.carousel[data-k]').forEach((c) => { scrolls[c.dataset.k] = c.scrollLeft; });

  const d = disc.data || disc.partial;
  const loading = !!disc.job;
  const chips = (items, val, action) => items.map(([k, label]) =>
    `<button class="chip ${val === k ? 'on' : ''}" data-action="${action}" data-v="${k}">${label}</button>`).join('');

  let body = '';
  if (!d || (!d.eps.length && loading)) {
    body = `<div class="spinner"></div><p class="muted center small">Loading TV schedules…</p>`;
  } else {
    const sec = discoverSections(d);
    const row = (k, title, sub, items, label) => items.length ? `<section class="dsec">
        <h3>${title}${sub ? `<span>${sub}</span>` : ''}</h3>
        <div class="carousel" data-k="${k}">${items.map((x) => discCard(x.sh, label(x))).join('')}</div>
      </section>` : '';
    const net = (sh) => sh.network || '';
    body = [
      row('popular', 'Popular this week', '', sec.popular, (x) => net(x.sh)),
      row('soon', 'New series', 'premiering soon', sec.soon, (x) => relDay(x.t)),
      row('back', 'Returning seasons', '', sec.back, (x) => `S${x.s} · ${relDay(x.t)}`),
      row('just', 'New series', 'just premiered', sec.just, (x) => `${relDay(x.t)} · ${net(x.sh)}`),
      row('today', 'On today', '', sec.today, (x) => (x.stamp ? `${fmtTime(x.t)} · ` : '') + net(x.sh)),
    ].join('') || (loading ? '<div class="spinner"></div>' : '<p class="muted center pad">Nothing matches these filters.</p>');
    if (loading) body = `<p class="muted center small">Loading schedules… ${Math.round((disc.done / disc.total) * 100)}%</p>` + body;
  }

  view.innerHTML = `
    <div class="chips">${chips(REGIONS, disc.region, 'region')}</div>
    <div class="chips">${chips(LANGS, disc.lang, 'lang')}</div>
    <div class="chips">${chips(TYPES, disc.type, 'dtype')}</div>
    ${body}
    <p class="credit">TV channels shown for the region picked; streaming services are always included. Schedules from <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a>.</p>`;

  view.querySelectorAll('.carousel[data-k]').forEach((c) => { if (scrolls[c.dataset.k]) c.scrollLeft = scrolls[c.dataset.k]; });
}

// ---------- view: My Shows ----------
let showsFilter = 'all';
const FILTERS = [
  ['all', 'All'], ['watching', 'Watching'], ['caught', 'Up to date'], ['plan', 'Plan to watch'], ['completed', 'Completed'], ['stopped', 'Stopped'],
];

function renderShows() {
  const ids = Object.keys(state.shows);
  if (!ids.length) {
    view.innerHTML = empty('No shows yet', 'Shows you add will live here.', '#/search', 'Find a show');
    return;
  }
  const cats = Object.fromEntries(ids.map((id) => [id, category(id)]));
  const counts = { all: ids.length };
  for (const c of Object.values(cats)) counts[c] = (counts[c] || 0) + 1;
  const list = ids
    .filter((id) => showsFilter === 'all' || cats[id] === showsFilter)
    .sort((a, b) => state.shows[a].name.localeCompare(state.shows[b].name));

  const chips = FILTERS.filter(([k]) => k === 'all' || counts[k]).map(([k, label]) =>
    `<button class="chip ${showsFilter === k ? 'on' : ''}" data-action="filter" data-f="${k}">${label} <span>${counts[k] || 0}</span></button>`).join('');

  const grid = list.map((id) => {
    const s = state.shows[id];
    const sm = summary(id);
    const pct = sm.aired ? Math.round(((sm.aired - sm.left) / sm.aired) * 100) : 0;
    return `<a class="tile" href="#/show/${id}">
      <div class="tile-img">${poster(s.img, s.name)}${sm.left > 0 && cats[id] !== 'plan' ? `<span class="count">${sm.left}</span>` : ''}${cats[id] === 'completed' ? `<span class="count ok">${ICON.check}</span>` : ''}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="tile-name">${esc(s.name)}</div>
    </a>`;
  }).join('');

  view.innerHTML = `<div class="chips">${chips}</div>
    ${list.length ? `<div class="grid">${grid}</div>` : '<p class="muted center pad">No shows here.</p>'}`;
}

// ---------- view: Stats ----------
function renderStats() {
  let eps = 0, mins = 0, week = 0, month = 0;
  const genres = {};
  const weeks = new Array(12).fill(0);
  const now = Date.now();
  for (const sid in state.watched) {
    const s = state.shows[sid];
    const c = getCachedEps(sid);
    const byId = new Map(c ? c.eps.map((e) => [e.id, e]) : []);
    for (const [eid, ts] of Object.entries(state.watched[sid])) {
      eps++;
      const rt = byId.get(eid)?.rt || s?.runtime || 30;
      mins += rt;
      for (const g of s?.genres || []) genres[g] = (genres[g] || 0) + 1;
      const age = now - ts;
      if (age < 7 * DAY) week++;
      if (age < 30 * DAY) month++;
      const wk = Math.floor(age / (7 * DAY));
      if (wk >= 0 && wk < 12) weeks[11 - wk]++;
    }
  }
  const ids = Object.keys(state.shows);
  const completed = ids.filter((id) => category(id) === 'completed').length;
  const months = Math.floor(mins / (30 * 1440));
  const days = Math.floor((mins % (30 * 1440)) / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const maxW = Math.max(1, ...weeks);
  const topG = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxG = Math.max(1, ...topG.map((g) => g[1]));

  view.innerHTML = `
    <section class="panel hero-stat">
      <div class="label">Time spent watching TV</div>
      <div class="time">
        ${(months ? [[months, 'month'], [days, 'day'], [hours, 'hour']] : [[days, 'day'], [hours, 'hour'], [mins % 60, 'minute']])
          .map(([n, w]) => `<div><b>${n}</b><span>${w}${n === 1 ? '' : 's'}</span></div>`).join('')}
      </div>
    </section>
    <section class="stat-grid">
      <div class="panel"><b>${eps.toLocaleString()}</b><span>Episodes watched</span></div>
      <div class="panel"><b>${ids.length}</b><span>Shows tracked</span></div>
      <div class="panel"><b>${week}</b><span>Episodes this week</span></div>
      <div class="panel"><b>${completed}</b><span>Shows completed</span></div>
    </section>
    <section class="panel">
      <h3>Last 12 weeks</h3>
      <div class="bars">${weeks.map((n, i) => `<div class="b" title="${n} episodes"><i style="height:${(n / maxW) * 100}%"></i><span>${i === 11 ? 'now' : ''}</span></div>`).join('')}</div>
      <p class="muted small">${month} episodes in the last 30 days</p>
    </section>
    ${topG.length ? `<section class="panel"><h3>Top genres</h3>${topG.map(([g, n]) => `<div class="hbar"><span>${esc(g)}</span><div><i style="width:${(n / maxG) * 100}%"></i></div><em>${n}</em></div>`).join('')}</section>` : ''}
    <section class="panel">
      <h3>Your data</h3>
      <p class="muted small">Everything is saved on this device. Back it up now and then so you never lose your history.</p>
      <div class="btn-row">
        <button class="btn" data-action="export">Export backup</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
      <div class="btn-row">
        <button class="btn" data-action="refresh-all">Refresh show info</button>
        <button class="btn danger-text" data-action="clear">Erase everything</button>
      </div>
    </section>
    <p class="credit">Show data from <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a> (CC BY-SA).</p>`;
}

// ---------- view: Search ----------
let lastQuery = '';
let lastResults = [];
let searchTimer;

function renderSearch() {
  view.innerHTML = `<div class="search">
      <input id="q" type="search" placeholder="Search for a show…" autocomplete="off" enterkeyhint="search" value="${esc(lastQuery)}">
    </div>
    <div id="results" class="list"></div>`;
  const q = $('#q');
  q.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(q.value.trim()), 350);
  });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(searchTimer); doSearch(q.value.trim()); q.blur(); } });
  drawResults();
  if (!lastQuery) setTimeout(() => q.focus(), 50);
}

async function doSearch(q) {
  lastQuery = q;
  if (!q) { lastResults = []; drawResults(); return; }
  const box = $('#results');
  if (box) box.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await searchShows(q);
    if (q !== lastQuery) return;
    lastResults = res;
    for (const s of res) if (!state.shows[s.id]) tempShows.set(s.id, s);
  } catch (err) {
    if (box && q === lastQuery) box.innerHTML = `<p class="muted center pad">${esc(err.message || "Couldn't search right now")}</p>`;
    return;
  }
  drawResults();
}

function drawResults() {
  const box = $('#results');
  if (!box) return;
  if (!lastQuery) { box.innerHTML = '<p class="muted center pad">Find shows by name, then add them to start tracking.</p>'; return; }
  if (!lastResults.length) { box.innerHTML = '<p class="muted center pad">No shows found.</p>'; return; }
  box.innerHTML = lastResults.map((s) => {
    const on = isTracked(s.id);
    const meta = [year(s.premiered), s.network, s.status].filter(Boolean).join(' · ');
    return `<article class="row" data-action="open" data-show="${s.id}">
      ${poster(s.img, s.name, 'thumb')}
      <div class="row-body">
        <div class="row-title">${esc(s.name)}</div>
        <div class="row-sub">${esc(meta)}</div>
        ${s.genres.length ? `<div class="row-sub dim">${esc(s.genres.slice(0, 3).join(', '))}</div>` : ''}
      </div>
      <button class="add ${on ? 'on' : ''}" data-action="${on ? 'open' : 'quick-add'}" data-show="${s.id}" aria-label="${on ? 'Added' : 'Add'} ${esc(s.name)}">${on ? ICON.check : ICON.plus}</button>
    </article>`;
  }).join('');
}

// ---------- view: Show detail ----------
const openSeasons = new Map();
const castCache = new Map();

async function renderShow(id) {
  const my = token;
  if (!showInfo(id) || !getCachedEps(id)) {
    const known = showInfo(id);
    $('#title').textContent = known ? known.name : '';
    view.innerHTML = '<div class="spinner"></div>';
    try { await loadShow(id); }
    catch (err) {
      if (my === token) view.innerHTML = `<p class="muted center pad">${esc(err.message || "Couldn't load this show")}</p>`;
      return;
    }
    if (my !== token) return;
  } else if (Date.now() - getCachedEps(id).at > FRESH_MS) {
    loadShow(id, true).then(() => { if (my === token) rerender(); }).catch(() => {});
  }
  drawShow(id);
  loadCast(id, my);
}

function drawShow(id) {
  const s = showInfo(id);
  const sm = summary(id);
  const tracked = isTracked(id);
  $('#title').textContent = s.name;

  const seasons = new Map();
  for (const e of sm.eps) {
    if (!seasons.has(e.s)) seasons.set(e.s, []);
    seasons.get(e.s).push(e);
  }
  if (!openSeasons.has(id)) {
    const open = sm.next ? sm.next.s : sm.upcoming ? sm.upcoming.s : [...seasons.keys()].pop();
    openSeasons.set(id, new Set(open != null ? [open] : []));
  }
  const open = openSeasons.get(id);

  const years = s.premiered ? `${year(s.premiered)}${s.status === 'Ended' && s.ended ? `–${year(s.ended)}` : s.status === 'Running' ? '–' : ''}` : '';
  const meta = [years, s.network, s.runtime ? `${s.runtime} min` : '', s.status].filter(Boolean).join(' · ');
  const pct = sm.aired ? Math.round(((sm.aired - sm.left) / sm.aired) * 100) : 0;

  const list = tracked ? state.shows[id].list : null;
  const actions = tracked
    ? `<div class="seg">
        ${[['watching', 'Watching'], ['plan', 'Plan to watch'], ['stopped', 'Stopped']].map(([k, l]) => `<button class="${list === k ? 'on' : ''}" data-action="list" data-show="${id}" data-list="${k}">${l}</button>`).join('')}
      </div>
      <button class="icon-btn danger" data-action="remove" data-show="${id}" aria-label="Remove show">${ICON.trash}</button>`
    : `<button class="btn primary grow" data-action="add" data-show="${id}" data-list="watching">${ICON.plus} Add to my shows</button>
       <button class="btn" data-action="add" data-show="${id}" data-list="plan">Plan to watch</button>`;

  const nextLine = sm.upcoming
    ? `<div class="next-air">Next episode: <b>${code(sm.upcoming)}</b> ${esc(relDay(airTime(sm.upcoming)))}${sm.upcoming.stamp ? `, ${esc(fmtTime(airTime(sm.upcoming)))}` : ''}</div>`
    : '';

  const seasonHtml = [...seasons.entries()].map(([num, eps]) => {
    const aired = eps.filter(isAired);
    const done = eps.filter((e) => isWatched(id, e.id)).length;
    const allDone = aired.length > 0 && aired.every((e) => isWatched(id, e.id));
    const isOpen = open.has(num);
    return `<section class="season ${isOpen ? 'open' : ''}">
      <div class="season-head">
        <button class="season-title" data-action="season-open" data-show="${id}" data-s="${num}" aria-expanded="${isOpen}">
          <span class="chev">${ICON.chev}</span>
          <span>Season ${num}</span>
          <small>${done}/${eps.length}</small>
        </button>
        <button class="chk ${allDone ? 'w' : ''}" data-action="season-mark" data-show="${id}" data-s="${num}" ${aired.length ? '' : 'disabled'} aria-label="Mark season ${num}">${ICON.check}</button>
      </div>
      ${isOpen ? `<div class="eps">${eps.map((e) => epRow(id, e)).join('')}</div>` : ''}
    </section>`;
  }).join('');

  view.innerHTML = `
    <div class="show-hero" ${s.img ? `style="--hero:url('${esc(s.imgLg || s.img)}')"` : ''}>
      ${poster(s.img, s.name, 'hero-poster')}
      <div class="hero-info">
        <h2>${esc(s.name)}</h2>
        <div class="muted small">${esc(meta)}</div>
        ${s.rating ? `<div class="rating">★ ${s.rating.toFixed(1)}</div>` : ''}
        <div class="genres">${s.genres.map((g) => `<span>${esc(g)}</span>`).join('')}</div>
      </div>
    </div>
    <div class="actions">${actions}</div>
    ${sm.aired ? `<div class="progress">
      <div class="progress-top"><span>${sm.aired - sm.left} of ${sm.aired} watched</span><span>${sm.left ? `${plural(sm.left, 'episode')} left` : 'All caught up'}</span></div>
      <div class="bar big"><i style="width:${pct}%"></i></div>
    </div>` : ''}
    ${nextLine}
    ${s.summary ? `<p class="summary clamp" data-action="expand">${esc(s.summary)}</p>` : ''}
    <div id="cast"></div>
    <div class="seasons">${seasonHtml || '<p class="muted center pad">No episodes listed yet.</p>'}</div>
    <p class="credit">Data from <a href="https://www.tvmaze.com/shows/${esc(id)}" target="_blank" rel="noopener">TVmaze</a></p>`;
  drawCast(id);
}

function epRow(sid, e) {
  const aired = isAired(e);
  const w = isWatched(sid, e.id);
  const t = airTime(e);
  return `<div class="ep ${w ? 'w' : ''} ${aired ? '' : 'future'}">
    <div class="ep-main" data-action="ep-info">
      <div class="ep-title"><span class="ep-n">${e.n}</span>${esc(e.name)}</div>
      <div class="ep-date">${aired ? esc(fmtDate(t)) : `Airs ${esc(relDay(t))}${e.stamp && !isNaN(t) ? `, ${esc(fmtTime(t))}` : ''}`}</div>
      ${e.sum ? `<div class="ep-sum" hidden>${esc(e.sum)}</div>` : ''}
    </div>
    <button class="chk ${w ? 'w' : ''}" data-action="ep" data-show="${sid}" data-ep="${e.id}" ${aired ? '' : 'disabled'} aria-label="${w ? 'Unmark' : 'Mark'} ${code(e)}">${ICON.check}</button>
  </div>`;
}

async function loadCast(id, my) {
  if (castCache.has(id)) return;
  try {
    const cast = await fetchCast(id);
    castCache.set(id, cast);
    if (my === token) drawCast(id);
  } catch (e) { /* cast is optional */ }
}

function drawCast(id) {
  const box = $('#cast');
  const cast = castCache.get(id);
  if (!box || !cast || !cast.length) return;
  box.innerHTML = `<h3 class="sub">Cast</h3><div class="cast">${cast.map((c) => `<div class="person">
      ${c.img ? `<img src="${esc(c.img)}" alt="" loading="lazy">` : `<div class="ph">${esc(c.person.slice(0, 1))}</div>`}
      <b>${esc(c.person)}</b><span>${esc(c.character)}</span>
    </div>`).join('')}</div>`;
}

// ---------- events ----------
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const a = el.dataset.action;
  const sid = el.dataset.show;
  if (a !== 'open') ev.stopPropagation();

  switch (a) {
    case 'back':
      if (history.length > 1) history.back(); else location.hash = '#/next';
      break;
    case 'open':
      location.hash = `#/show/${sid}`;
      break;
    case 'ep':
      if (!getCachedEps(sid)) await loadShow(sid).catch(() => {});
      toggleEp(sid, el.dataset.ep);
      break;
    case 'season-open': {
      const set = openSeasons.get(sid);
      const n = +el.dataset.s;
      set.has(n) ? set.delete(n) : set.add(n);
      rerender();
      break;
    }
    case 'season-mark':
      toggleSeason(sid, +el.dataset.s);
      break;
    case 'ep-info': {
      const sum = el.querySelector('.ep-sum');
      if (sum) sum.hidden = !sum.hidden;
      break;
    }
    case 'expand':
      el.classList.toggle('clamp');
      break;
    case 'quick-add':
    case 'add': {
      const list = el.dataset.list || 'watching';
      el.disabled = true;
      try { await loadShow(sid); } catch (err) { toast(err.message || "Couldn't add that show"); el.disabled = false; return; }
      const undo = snapshot(sid);
      track(sid, list);
      save();
      if (current.name === 'search') drawResults();
      else if (current.name === 'discover') {
        el.disabled = false;
        el.classList.add('on');
        el.dataset.action = 'open';
        el.innerHTML = ICON.check;
      } else rerender();
      toast(`${showInfo(sid).name} added${list === 'plan' ? ' to Plan to watch' : ''}`, undo);
      break;
    }
    case 'list':
      state.shows[sid].list = el.dataset.list;
      save(); rerender();
      break;
    case 'remove':
      removeShow(sid);
      break;
    case 'filter':
      showsFilter = el.dataset.f;
      rerender();
      break;
    case 'region':
      if (disc.region === el.dataset.v) break;
      disc.region = el.dataset.v;
      localStorage.setItem('upnext.region', disc.region);
      // picking an Asian region switches the language to match (and back to English for the others)
      if (disc.lang !== 'any') { disc.lang = REGION_LANG[disc.region]; localStorage.setItem('upnext.lang', disc.lang); }
      disc.job = null;
      loadDiscover(true);
      rerender();
      break;
    case 'lang':
      disc.lang = el.dataset.v;
      localStorage.setItem('upnext.lang', disc.lang);
      rerender();
      break;
    case 'dtype':
      disc.type = el.dataset.v;
      rerender();
      break;
    case 'export': {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `up-next-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      break;
    }
    case 'refresh-all':
      refreshAll(true);
      break;
    case 'clear':
      sheet('Erase all your shows and watch history from this device? This cannot be undone.', [
        { label: 'Erase everything', danger: true, fn: () => { clearAll(); toast('All data erased'); rerender(); } },
      ]);
      break;
  }
});

document.addEventListener('change', (ev) => {
  const input = ev.target.closest('[data-action="import"]');
  if (!input || !input.files[0]) return;
  const file = input.files[0];
  input.value = '';
  file.text().then((text) => {
    sheet('Replace the data on this device with this backup?', [
      {
        label: 'Restore backup', primary: true, fn: () => {
          try { importData(text); toast('Backup restored'); refreshAll(false); rerender(); }
          catch (err) { toast(err.message || "Couldn't read that file"); }
        },
      },
    ]);
  });
});

// ---------- background refresh ----------
let refreshing = false;
async function refreshAll(force) {
  if (refreshing) return;
  const ids = Object.keys(state.shows).filter((id) => {
    const c = getCachedEps(id);
    return force || !c || Date.now() - c.at > FRESH_MS;
  });
  if (!ids.length) return;
  refreshing = true;
  if (force) toast(`Refreshing ${plural(ids.length, 'show')}…`);
  let failed = 0;
  await Promise.all(ids.map((id) => loadShow(id, true).then(() => rerender()).catch(() => { failed++; })));
  refreshing = false;
  if (force) toast(failed ? `Couldn't refresh ${plural(failed, 'show')} — check your connection` : 'All shows up to date');
  rerender();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { refreshAll(false); rerender(); }
});

// ---------- start ----------
window.addEventListener('hashchange', route);
route();
refreshAll(false);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// TVmaze API wrapper — free, no key, CORS enabled. Rate limit is ~20 calls / 10s,
// so calls go through a small queue and back off on HTTP 429.
const BASE = 'https://api.tvmaze.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let active = 0;
const queue = [];
function pump() {
  while (active < 3 && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
}
function limited(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

async function get(path) {
  return limited(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(BASE + path);
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`TVmaze error ${res.status}`);
      return res.json();
    }
    throw new Error('TVmaze is busy — try again in a moment');
  });
}

const decoder = typeof document !== 'undefined' ? document.createElement('textarea') : null;
export function strip(html) {
  if (!html) return '';
  const noTags = html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  if (!decoder) return noTags.trim();
  decoder.innerHTML = noTags;
  return decoder.value.replace(/\s+/g, ' ').trim();
}

export function slimShow(s) {
  const channel = s.network || s.webChannel;
  return {
    id: String(s.id),
    name: s.name,
    img: s.image?.medium || null,
    imgLg: s.image?.original || null,
    status: s.status || '',
    network: channel?.name || '',
    country: channel?.country?.code || s.network?.country?.code || '',
    runtime: s.runtime || s.averageRuntime || null,
    genres: s.genres || [],
    premiered: s.premiered || null,
    ended: s.ended || null,
    rating: s.rating?.average ?? null,
    language: s.language || '',
    summary: strip(s.summary),
  };
}

export function slimEp(e) {
  return {
    id: String(e.id),
    s: e.season,
    n: e.number,
    name: e.name || 'TBA',
    date: e.airdate || null,
    stamp: e.airstamp || null,
    rt: e.runtime || null,
    img: e.image?.medium || null,
    sum: strip(e.summary).slice(0, 500),
  };
}

export async function searchShows(q) {
  const res = await get(`/search/shows?q=${encodeURIComponent(q)}`);
  return (res || []).map((r) => slimShow(r.show));
}

export async function fetchShow(id) {
  const res = await get(`/shows/${encodeURIComponent(id)}?embed=episodes`);
  if (!res) return null;
  const eps = (res._embedded?.episodes || [])
    .filter((e) => e.number != null && e.season != null)
    .map(slimEp)
    .sort((a, b) => a.s - b.s || a.n - b.n);
  return { show: slimShow(res), eps };
}

export async function fetchCast(id) {
  const res = await get(`/shows/${encodeURIComponent(id)}/cast`);
  return (res || []).slice(0, 15).map((c) => ({
    person: c.person?.name || '',
    character: c.character?.name || '',
    img: c.character?.image?.medium || c.person?.image?.medium || null,
  }));
}

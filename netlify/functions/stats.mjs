/**
 * Netlify Function: stats
 * Private analytics dashboard for the /api/track data.
 * Protected by a secret key: /api/stats?key=YOUR_STATS_KEY
 *
 * Required env vars:
 *   STATS_KEY — random secret string, set in Netlify dashboard
 *
 * Days are UTC. Finished days are aggregated once and cached in the
 * "analytics" blob store under daily/<date>.json; raw events are kept.
 */

import { getStore } from '@netlify/blobs';

const OWN_HOSTS = new Set(['darkfantasyaiart.com', 'www.darkfantasyaiart.com']);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function aggregateDay(store, day) {
  const agg = { views: 0, uniques: 0, bots: 0, paths: {}, refs: {} };
  const seen = new Set();
  const { blobs } = await store.list({ prefix: `events/${day}/` });
  const keys = blobs.map((b) => b.key);

  for (let i = 0; i < keys.length; i += 25) {
    const chunk = await Promise.all(
      keys.slice(i, i + 25).map((k) => store.get(k, { type: 'json' }))
    );
    for (const e of chunk) {
      if (!e) continue;
      if (e.b) {
        agg.bots++;
        continue;
      }
      agg.views++;
      seen.add(e.v);
      agg.paths[e.p] = (agg.paths[e.p] || 0) + 1;
      let host = '';
      try {
        host = e.r ? new URL(e.r).hostname : '';
      } catch {}
      if (host && !OWN_HOSTS.has(host)) {
        agg.refs[host] = (agg.refs[host] || 0) + 1;
      }
    }
  }
  agg.uniques = seen.size;
  return agg;
}

function topEntries(obj, n) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function renderPage(days, daily) {
  const totals = { views: 0, bots: 0, paths: {}, refs: {} };
  for (const day of days) {
    const d = daily[day];
    totals.views += d.views;
    totals.bots += d.bots;
    for (const [p, n] of Object.entries(d.paths)) totals.paths[p] = (totals.paths[p] || 0) + n;
    for (const [r, n] of Object.entries(d.refs)) totals.refs[r] = (totals.refs[r] || 0) + n;
  }

  const maxViews = Math.max(1, ...days.map((d) => daily[d].views));
  const bars = days
    .map((day) => {
      const d = daily[day];
      const h = Math.round((d.views / maxViews) * 100);
      return `<div class="bar" title="${day}: ${d.views} views, ${d.uniques} visitors">
        <div class="fill" style="height:${h}%"></div><span>${day.slice(8)}</span></div>`;
    })
    .join('');

  const dayRows = [...days]
    .reverse()
    .map(
      (day) =>
        `<tr><td>${day}</td><td>${daily[day].views}</td><td>${daily[day].uniques}</td><td class="dim">${daily[day].bots}</td></tr>`
    )
    .join('');

  const pathRows = topEntries(totals.paths, 15)
    .map(([p, n]) => `<tr><td>${esc(p)}</td><td>${n}</td></tr>`)
    .join('');
  const refRows = topEntries(totals.refs, 15)
    .map(([r, n]) => `<tr><td>${esc(r)}</td><td>${n}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Site Stats — Dark Fantasy AI Art</title>
<style>
  body{background:#0d0a12;color:#d8cfe0;font-family:Georgia,serif;margin:0;padding:2rem;max-width:960px;margin:auto}
  h1{color:#b08fd8;font-weight:normal;letter-spacing:2px}
  h2{color:#8a6fb0;font-weight:normal;margin-top:2.5rem;border-bottom:1px solid #2a2135;padding-bottom:.3rem}
  .cards{display:flex;gap:1rem;flex-wrap:wrap;margin:1.5rem 0}
  .card{background:#161020;border:1px solid #2a2135;border-radius:8px;padding:1rem 1.5rem;min-width:140px}
  .card .num{font-size:2rem;color:#e8ddf5}
  .card .label{font-size:.8rem;color:#8a7f99;text-transform:uppercase;letter-spacing:1px}
  .chart{display:flex;align-items:flex-end;gap:3px;height:140px;margin:1rem 0;padding:1rem;background:#161020;border:1px solid #2a2135;border-radius:8px;overflow-x:auto}
  .bar{flex:0 0 auto;width:10px;display:flex;flex-direction:column;justify-content:flex-end;height:100%;text-align:center}
  .bar .fill{background:linear-gradient(to top,#5a3d8a,#9b6fd8);border-radius:2px 2px 0 0;min-height:2px}
  .bar span{font-size:.6rem;color:#5a5266;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin:1rem 0}
  td,th{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #1e1729}
  th{color:#8a7f99;font-size:.8rem;text-transform:uppercase;letter-spacing:1px}
  td:not(:first-child),th:not(:first-child){text-align:right}
  .dim{color:#5a5266}
  .note{color:#5a5266;font-size:.85rem}
</style></head><body>
<h1>&#9884; Site Stats</h1>
<div class="cards">
  <div class="card"><div class="num">${totals.views}</div><div class="label">Total views</div></div>
  <div class="card"><div class="num">${days.length ? daily[days[days.length - 1]].views : 0}</div><div class="label">Views today (UTC)</div></div>
  <div class="card"><div class="num">${days.length ? daily[days[days.length - 1]].uniques : 0}</div><div class="label">Visitors today</div></div>
  <div class="card"><div class="num dim">${totals.bots}</div><div class="label">Bot hits (excluded)</div></div>
</div>
<h2>Daily views (all time, scroll for full history)</h2>
<div class="chart">${bars || '<p class="note">No data yet — check back after some traffic.</p>'}</div>
<h2>Daily breakdown</h2>
<table><tr><th>Date (UTC)</th><th>Views</th><th>Visitors</th><th>Bots</th></tr>${dayRows}</table>
<h2>Top pages (all time)</h2>
<table><tr><th>Page</th><th>Views</th></tr>${pathRows}</table>
<h2>Traffic sources (all time)</h2>
<table><tr><th>Referrer</th><th>Views</th></tr>${refRows || '<tr><td class="note" colspan="2">Direct visits and in-app browsers often send no referrer.</td></tr>'}</table>
<p class="note">Tracking since 2026-07-03. Bots are counted separately and excluded from views. Visitor counts are per-day (anonymous ids rotate daily). Your own devices are excluded if you visited the site once with ?notrack in the address.</p>
</body></html>`;
}

export default async (req) => {
  const KEY = process.env.STATS_KEY || '';
  const url = new URL(req.url);

  if (!KEY) {
    return new Response(
      '<h1>One step left</h1><p>Add a <code>STATS_KEY</code> environment variable in Netlify (Site configuration &rarr; Environment variables), then redeploy. Your dashboard will be at <code>/api/stats?key=YOUR_KEY</code>.</p>',
      { status: 503, headers: { 'content-type': 'text/html' } }
    );
  }
  if (url.searchParams.get('key') !== KEY) {
    return new Response('Not found', { status: 404 });
  }

  const store = getStore('analytics');
  const today = new Date().toISOString().slice(0, 10);

  const { directories } = await store.list({ prefix: 'events/', directories: true });
  const days = directories.map((d) => d.split('/')[1]).filter(Boolean).sort();

  const daily = {};
  for (const day of days) {
    if (day !== today) {
      const cached = await store.get(`daily/${day}.json`, { type: 'json' });
      if (cached) {
        daily[day] = cached;
        continue;
      }
    }
    const agg = await aggregateDay(store, day);
    daily[day] = agg;
    if (day !== today) {
      await store.setJSON(`daily/${day}.json`, agg);
    }
  }

  return new Response(renderPage(days, daily), {
    status: 200,
    headers: { 'content-type': 'text/html', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/stats' };

/**
 * Netlify Function: track
 * First-party pageview tracker. Pages send a tiny beacon to /api/track;
 * each view is stored permanently in Netlify Blobs (store: "analytics").
 * Raw IPs are never stored — visitors get an anonymous id that rotates daily.
 * View the dashboard at /api/stats (see stats.mjs).
 */

import { getStore } from '@netlify/blobs';

const BOT_RE = /bot|crawl|spider|slurp|preview|scan|curl|python|wget|monitor|facebookexternalhit|whatsapp|telegram|slack|discord|pinterest|bytespider|gptbot|headless|lighthouse/i;

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  let data = {};
  try {
    data = JSON.parse(await req.text());
  } catch {
    // malformed beacon — still count it as a bare pageview
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const ua = req.headers.get('user-agent') || '';
  const ip = context.ip || '';

  // anonymous visitor id: hash of day + ip + user agent, rotates daily
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${day}|${ip}|${ua}`)
  );
  const vid = [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const event = {
    t: now.toISOString(),
    p: String(data.p || '/').slice(0, 200),
    r: String(data.r || '').slice(0, 300),
    v: vid,
    b: BOT_RE.test(ua) ? 1 : 0,
  };

  const store = getStore('analytics');
  const key = `events/${day}/${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  await store.setJSON(key, event);

  return new Response(null, { status: 204 });
};

export const config = { path: '/api/track' };

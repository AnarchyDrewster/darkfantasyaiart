#!/usr/bin/env node
/**
 * Run this ONE TIME locally to get your TikTok access + refresh tokens.
 * Then add them as Netlify environment variables.
 *
 * Usage:
 *   set TIKTOK_CLIENT_KEY=your_key
 *   set TIKTOK_CLIENT_SECRET=your_secret
 *   node tiktok-auth.js
 *
 * Then open the URL it prints, authorize, and copy the tokens into Netlify.
 */

const https = require('https');
const http  = require('http');
const qs    = require('querystring');

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI  = 'https://darkfantasyaiart.com/callback';

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error('\nERROR: Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET environment variables first.\n');
  process.exit(1);
}

// IMPORTANT: Add http://localhost:3000/callback as a redirect URI in your
// TikTok developer portal under App details > Redirect URI before running this.

const authUrl = 'https://www.tiktok.com/v2/auth/authorize/?' + qs.stringify({
  client_key:    CLIENT_KEY,
  scope:         'user.info.basic,video.publish',
  response_type: 'code',
  redirect_uri:  REDIRECT_URI,
  state:         'darkfantasy',
});

console.log('\n🔐 TikTok OAuth Setup for Dark Fantasy AI Art\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('BEFORE RUNNING: make sure you added this redirect URI in TikTok dev portal:');
console.log('  http://localhost:3000/callback\n');
console.log('Open this URL in your browser and authorize:\n');
console.log(authUrl);
console.log('\nWaiting for callback on port 3000...\n');

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No authorization code received. Try again.');
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2 style="font-family:sans-serif;padding:40px">✅ Authorized! Check your terminal for the tokens.</h2>');
  server.close();

  console.log('✅ Got authorization code. Exchanging for tokens...\n');

  // Exchange code for access + refresh tokens
  const body = qs.stringify({
    client_key:    CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT_URI,
  });

  const options = {
    hostname: 'open.tiktokapis.com',
    path:     '/v2/oauth/token/',
    method:   'POST',
    headers: {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const tokenReq = https.request(options, tokenRes => {
    let data = '';
    tokenRes.on('data', c => (data += c));
    tokenRes.on('end', () => {
      try {
        const t = JSON.parse(data);
        if (t.error) {
          console.error('ERROR from TikTok:', t.error, t.error_description);
          return;
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Add these to Netlify → Site configuration → Environment variables:\n');
        console.log(`TIKTOK_ACCESS_TOKEN=${t.access_token}`);
        console.log(`TIKTOK_REFRESH_TOKEN=${t.refresh_token}`);
        console.log(`TIKTOK_CLIENT_KEY=${CLIENT_KEY}`);
        console.log(`TIKTOK_CLIENT_SECRET=${CLIENT_SECRET}`);
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Access token expires in: ${Math.round(t.expires_in / 3600)} hours`);
        console.log(`Refresh token expires in: ${Math.round(t.refresh_expires_in / 86400)} days\n`);
        console.log('Scope granted:', t.scope);
      } catch (e) {
        console.error('Failed to parse token response:', data);
      }
    });
  });

  tokenReq.on('error', err => console.error('Request error:', err.message));
  tokenReq.write(body);
  tokenReq.end();
});

server.listen(3000, () => {
  console.log('Local server listening on http://localhost:3000\n');
});

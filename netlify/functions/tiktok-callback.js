/**
 * Netlify Function: TikTok OAuth Callback
 * URL: https://darkfantasyaiart.com/.netlify/functions/tiktok-callback
 *
 * TikTok redirects here after the user authorizes the app.
 * It exchanges the auth code for access + refresh tokens and displays them.
 *
 * Set these in Netlify env vars first:
 *   TIKTOK_CLIENT_KEY
 *   TIKTOK_CLIENT_SECRET
 */

const https = require('https');
const qs    = require('querystring');

const REDIRECT_URI = 'https://darkfantasyaiart.com/callback';

exports.handler = async (event) => {
  const code  = event.queryStringParameters && event.queryStringParameters.code;
  const error = event.queryStringParameters && event.queryStringParameters.error;

  if (error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `<h2 style="font-family:sans-serif;padding:40px;color:red">❌ TikTok auth error: ${error}</h2>`,
    };
  }

  if (!code) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `<h2 style="font-family:sans-serif;padding:40px;color:red">❌ No authorization code received.</h2>`,
    };
  }

  const CK = process.env.TIKTOK_CLIENT_KEY;
  const CS = process.env.TIKTOK_CLIENT_SECRET;

  if (!CK || !CS) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `<h2 style="font-family:sans-serif;padding:40px;color:red">❌ TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set in Netlify env vars.</h2>`,
    };
  }

  // Exchange code for tokens
  const body = qs.stringify({
    client_key:    CK,
    client_secret: CS,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT_URI,
  });

  const tokens = await new Promise((resolve, reject) => {
    const options = {
      hostname: 'open.tiktokapis.com',
      path:     '/v2/oauth/token/',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (tokens.error) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `<h2 style="font-family:sans-serif;padding:40px;color:red">❌ Token error: ${tokens.error} — ${tokens.error_description}</h2>`,
    };
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>TikTok Auth — Dark Fantasy AI Art</title>
  <style>
    body { font-family: sans-serif; background: #0a0a0a; color: #eee; padding: 40px; }
    h1 { color: #c084fc; }
    .box { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 20px; margin: 16px 0; }
    code { color: #4ade80; font-size: 13px; word-break: break-all; }
    .label { color: #888; font-size: 12px; margin-bottom: 4px; }
    .step { color: #f59e0b; font-weight: bold; }
    button { background: #c084fc; color: #000; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>✅ TikTok Authorized!</h1>
  <p>Copy these 4 values into <strong>Netlify → Site configuration → Environment variables</strong>:</p>

  <div class="box">
    <div class="label">TIKTOK_ACCESS_TOKEN</div>
    <code>${tokens.access_token}</code>
    <br><button onclick="navigator.clipboard.writeText('${tokens.access_token}')">Copy</button>
  </div>

  <div class="box">
    <div class="label">TIKTOK_REFRESH_TOKEN</div>
    <code>${tokens.refresh_token}</code>
    <br><button onclick="navigator.clipboard.writeText('${tokens.refresh_token}')">Copy</button>
  </div>

  <div class="box">
    <div class="label">TIKTOK_CLIENT_KEY</div>
    <code>${CK}</code>
    <br><button onclick="navigator.clipboard.writeText('${CK}')">Copy</button>
  </div>

  <div class="box">
    <div class="label">TIKTOK_CLIENT_SECRET</div>
    <code>${CS}</code>
    <br><button onclick="navigator.clipboard.writeText('${CS}')">Copy</button>
  </div>

  <p style="margin-top:32px; color:#888;">
    Access token expires in: <strong style="color:#eee">${Math.round(tokens.expires_in / 3600)} hours</strong><br>
    Refresh token expires in: <strong style="color:#eee">${Math.round(tokens.refresh_expires_in / 86400)} days</strong>
  </p>

  <p style="color:#888">After adding the env vars, trigger a redeploy on Netlify — then every new art push will auto-post to TikTok. 🖤</p>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: html,
  };
};

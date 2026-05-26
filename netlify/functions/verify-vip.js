/**
 * Netlify Function: verify-vip
 * Verifies a VIP access token and returns the unlocked album contents.
 * Tokens are HMAC-SHA256 signed — no database needed.
 *
 * Required env vars:
 *   VIP_SECRET — random secret string, set in Netlify dashboard
 */

const crypto = require('crypto');

const VIP_SECRET = process.env.VIP_SECRET;

// VIP album definitions — add more albums here in the future
const ALBUMS = {
  vault: {
    name: "Drew's Secret Vault",
    desc: 'Exclusive members-only collection.',
    images: [
      { id: 'vip_1', name: 'Vault I',   img: 'images/vip/vault/vip_1.png' },
      { id: 'vip_2', name: 'Vault II',  img: 'images/vip/vault/vip_2.png' },
      { id: 'vip_3', name: 'Vault III', img: 'images/vip/vault/vip_3.png' },
      { id: 'vip_4', name: 'Vault IV',  img: 'images/vip/vault/vip_4.png' },
      { id: 'vip_5', name: 'Vault V',   img: 'images/vip/vault/vip_5.png' },
      { id: 'vip_6', name: 'Vault VI',  img: 'images/vip/vault/vip_6.png' },
      { id: 'vip_7', name: 'Vault VII', img: 'images/vip/vault/vip_7.png' },
    ]
  }
};

function verifyToken(token) {
  if (!VIP_SECRET) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  try {
    const expected = crypto
      .createHmac('sha256', VIP_SECRET)
      .update(payload)
      .digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let token;
  try {
    ({ token } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  if (!token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'No token provided' }) };
  }

  const data = verifyToken(token.trim());
  if (!data) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired access code' }) };
  }

  const album = ALBUMS[data.album] || ALBUMS.vault;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      album: album.name,
      images: album.images,
      email: data.email,
    }),
  };
};

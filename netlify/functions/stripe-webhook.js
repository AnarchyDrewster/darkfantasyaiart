/**
 * Netlify Function: stripe-webhook
 * Fires on every completed Stripe checkout.
 * Sends the customer an email with their download link.
 *
 * Required env vars (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY       — already set
 *   STRIPE_WEBHOOK_SECRET   — from Stripe dashboard > Webhooks
 *   RESEND_API_KEY          — from resend.com dashboard
 */

const https = require('https');
const crypto = require('crypto');
const qs = require('querystring');

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const RESEND_KEY = process.env.RESEND_API_KEY;
const SITE_URL = 'https://darkfantasyaiart.com';

// ── Stripe helper ────────────────────────────────────────────────────────────
function stripe(method, path, params = {}) {
  return new Promise((resolve, reject) => {
    const body = method !== 'GET' ? qs.stringify(params) : '';
    const qstr = method === 'GET' && Object.keys(params).length ? '?' + qs.stringify(params) : '';
    const options = {
      hostname: 'api.stripe.com',
      port: 443,
      path: `/v1/${path}${qstr}`,
      method,
      headers: {
        Authorization: `Bearer ${STRIPE_KEY}`,
        ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Resend email helper ──────────────────────────────────────────────────────
function sendDownloadEmail(to, productName, downloadUrl) {
  const body = JSON.stringify({
    from: "Drew's Beginning <onboarding@resend.dev>",
    to: [to],
    subject: `Your Download is Ready — ${productName}`,
    html: `
      <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#050507;color:#e8e0d0;padding:40px 40px 32px;">
        <h1 style="font-family:Georgia,serif;color:#c9a84c;font-size:22px;margin:0 0 4px;">Drew's Beginning</h1>
        <p style="color:#9a8e7a;font-size:11px;letter-spacing:3px;text-transform:uppercase;margin:0 0 36px;">Dark Fantasy AI Art</p>
        <h2 style="color:#e8e0d0;font-size:18px;margin:0 0 12px;">Thank you for your purchase!</h2>
        <p style="color:#9a8e7a;margin:0 0 8px;">Your artwork <strong style="color:#e8e0d0;">${productName}</strong> is ready.</p>
        <p style="color:#9a8e7a;margin:0 0 28px;">Click below to download your high-resolution PNG file.</p>
        <a href="${downloadUrl}"
           style="display:inline-block;background:#c9a84c;color:#050507;padding:14px 36px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-family:Georgia,serif;margin-bottom:28px;">
          Download Your Artwork
        </a>
        <p style="color:#7a6030;font-size:12px;margin:0 0 4px;">If the button doesn't work, copy and paste this link:</p>
        <p style="color:#7a6030;font-size:11px;word-break:break-all;margin:0 0 32px;">${downloadUrl}</p>
        <hr style="border:none;border-top:1px solid #1e1e2e;margin:0 0 20px;">
        <p style="color:#7a6030;font-size:11px;margin:0;">Questions? Email <a href="mailto:lyleandy@ymail.com" style="color:#c9a84c;">lyleandy@ymail.com</a></p>
      </div>
    `
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Stripe signature verification ────────────────────────────────────────────
function verifySignature(payload, header, secret) {
  const parts = header.split(',');
  const timestamp = (parts.find(p => p.startsWith('t=')) || '').replace('t=', '');
  const sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.replace('v1=', ''));
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return sigs.some(sig => {
    try { return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); }
    catch { return false; }
  });
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const sig = event.headers['stripe-signature'];
  if (!verifySignature(event.body, sig, WEBHOOK_SECRET)) {
    console.error('Invalid Stripe signature');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  const evt = JSON.parse(event.body);
  if (evt.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session = evt.data.object;
  const customerEmail = session.customer_details?.email;
  if (!customerEmail) {
    console.error('No customer email in session');
    return { statusCode: 200, body: 'No email' };
  }

  // Get the purchased price ID from line items
  const lineItems = await stripe('GET', `checkout/sessions/${session.id}/line_items`, { limit: 1 });
  const priceId = lineItems?.data?.[0]?.price?.id;
  if (!priceId) return { statusCode: 200, body: 'No price' };

  // Get price → product
  const price = await stripe('GET', `prices/${priceId}`);
  const product = await stripe('GET', `products/${price.product}`);

  const productName = product.name;
  const img = product.metadata?.img;         // e.g. "images/art_60.png"
  const siteId = product.metadata?.site_id;  // fallback

  // Build download URL — use stored img path if available, else guess from site_id
  const filePath = img || `images/art_${siteId}.png`;
  const downloadUrl = `${SITE_URL}/${filePath}`;

  // Send the email
  const result = await sendDownloadEmail(customerEmail, productName, downloadUrl);
  console.log(`Download email sent to ${customerEmail} for "${productName}" — ${downloadUrl}`, result);

  return { statusCode: 200, body: 'OK' };
};

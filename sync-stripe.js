#!/usr/bin/env node
/**
 * Runs during Netlify build. Reads products.json, creates/updates each product
 * in Stripe, generates a Payment Link, and writes the links back to products.json.
 * The deployed site then serves products.json with live payment URLs.
 */
const https = require('https');
const fs = require('fs');
const qs = require('querystring');

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('STRIPE_SECRET_KEY not set'); process.exit(1); }

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
        Authorization: `Bearer ${KEY}`,
        ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function priceCents(priceStr) {
  return Math.round(parseFloat(priceStr.replace('$', '')) * 100);
}

async function syncProduct(p) {
  let { stripeProductId, stripePriceId, stripePaymentLink } = p;
  const cents = priceCents(p.price);

  if (!stripeProductId) {
    const prod = await stripe('POST', 'products', {
      name: p.name,
      description: p.desc,
      'metadata[site_id]': String(p.id),
    });
    stripeProductId = prod.id;
    console.log(`  + Created product: ${p.name} (${stripeProductId})`);
  } else {
    await stripe('POST', `products/${stripeProductId}`, {
      name: p.name,
      description: p.desc,
    });
    console.log(`  ~ Updated product: ${p.name}`);
  }

  if (!stripePriceId) {
    const price = await stripe('POST', 'prices', {
      product: stripeProductId,
      unit_amount: cents,
      currency: 'usd',
    });
    stripePriceId = price.id;
  }

  if (!stripePaymentLink) {
    const link = await stripe('POST', 'payment_links', {
      'line_items[0][price]': stripePriceId,
      'line_items[0][quantity]': 1,
    });
    stripePaymentLink = link.url;
  }

  return { ...p, stripeProductId, stripePriceId, stripePaymentLink };
}

async function main() {
  const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
  console.log(`\nSyncing ${products.length} products to Stripe...\n`);

  const updated = [];
  for (const p of products) {
    try {
      const result = await syncProduct(p);
      updated.push(result);
    } catch (err) {
      console.error(`  ERROR ${p.name}: ${err.message}`);
      updated.push(p);
    }
  }

  fs.writeFileSync('products.json', JSON.stringify(updated, null, 2));
  console.log('\nDone. products.json updated with Stripe payment links.\n');
}

main().catch(err => { console.error(err.message); process.exit(1); });

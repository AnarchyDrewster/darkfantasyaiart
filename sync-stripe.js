#!/usr/bin/env node
/**
 * Runs during Netlify build. Reads products.json, creates/updates each product
 * in Stripe, generates a Payment Link, and writes the links back to products.json.
 * The deployed site then serves products.json with live payment URLs.
 */
const https = require('https');
const fs = require('fs');
const qs = require('querystring');

const KEY             = process.env.STRIPE_SECRET_KEY;
const TIKTOK_TOKEN    = process.env.TIKTOK_ACCESS_TOKEN;
const TIKTOK_REFRESH  = process.env.TIKTOK_REFRESH_TOKEN;
const TIKTOK_CK       = process.env.TIKTOK_CLIENT_KEY;
const TIKTOK_CS       = process.env.TIKTOK_CLIENT_SECRET;

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

// Fetch all existing Stripe products tagged with site_id metadata
async function buildStripeCache() {
  const cache = {}; // site_id -> { stripeProductId, stripePaymentLink }
  let after = undefined;
  while (true) {
    const params = { limit: 100 };
    if (after) params.starting_after = after;
    const result = await stripe('GET', 'products', params);
    for (const prod of result.data) {
      if (prod.metadata && prod.metadata.site_id) {
        cache[prod.metadata.site_id] = {
          stripeProductId: prod.id,
          stripePaymentLink: prod.metadata.payment_link || ''
        };
      }
    }
    if (!result.has_more || result.data.length === 0) break;
    after = result.data[result.data.length - 1].id;
  }
  return cache;
}

// Find existing active price for a Stripe product
async function getExistingPrice(stripeProductId) {
  const result = await stripe('GET', 'prices', { product: stripeProductId, limit: 1, active: 'true' });
  return result.data.length > 0 ? result.data[0].id : null;
}

// ── TikTok helpers ───────────────────────────────────────────────────────────

function tiktokRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'open.tiktokapis.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('TikTok parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function refreshTikTokToken() {
  if (!TIKTOK_REFRESH || !TIKTOK_CK || !TIKTOK_CS) return null;
  const body = `client_key=${encodeURIComponent(TIKTOK_CK)}&client_secret=${encodeURIComponent(TIKTOK_CS)}&grant_type=refresh_token&refresh_token=${encodeURIComponent(TIKTOK_REFRESH)}`;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'open.tiktokapis.com',
      path: '/v2/oauth/token/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const t = JSON.parse(data);
          resolve(t.access_token || null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function postNewProductsToTikTok(newProducts) {
  if (!newProducts.length) return;

  let token = TIKTOK_TOKEN;
  if (!token) {
    console.log('\nTIKTOK_ACCESS_TOKEN not set — skipping TikTok posts.');
    console.log('Run tiktok-auth.js once to get your tokens, then add them to Netlify env vars.\n');
    return;
  }

  console.log(`\n📱 Posting ${newProducts.length} new product(s) to TikTok...\n`);

  for (const p of newProducts) {
    // Use GitHub raw URL — image is already pushed before build runs
    const ext = p.img.split('.').pop();
    const imageUrl = `https://raw.githubusercontent.com/AnarchyDrewster/darkfantasyaiart/master/${p.img}`;
    const caption = `${p.name} 🖤\n${p.desc}\n\n🔗 darkfantasyaiart.com/#product-${p.id}\n\n#darkfantasyart #aiart #digitalart #darkart #fantasyart #aiartwork #darkfantasy`;

    const payload = {
      post_info: {
        title: caption,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        auto_add_music: true,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: 0,
        photo_images: [imageUrl],
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    };

    try {
      let result = await tiktokRequest('POST', '/v2/post/publish/content/init/', payload, token);

      // If token expired, try refreshing once
      if (result.error && result.error.code === 'access_token_invalid') {
        console.log('  Access token expired — attempting refresh...');
        const newToken = await refreshTikTokToken();
        if (newToken) {
          token = newToken;
          result = await tiktokRequest('POST', '/v2/post/publish/content/init/', payload, token);
        }
      }

      if (result.error && result.error.code !== 'ok') {
        console.error(`  ❌ TikTok error for "${p.name}": ${result.error.message} (${result.error.code})`);
      } else {
        console.log(`  ✅ TikTok post published: "${p.name}"`);
        console.log(`     🔗 https://darkfantasyaiart.com/#product-${p.id}`);
      }
    } catch (err) {
      console.error(`  ❌ TikTok request failed for "${p.name}": ${err.message}`);
    }
  }
  console.log('');
}

// ── Stripe sync ──────────────────────────────────────────────────────────────

async function syncProduct(p, cache) {
  let { stripeProductId, stripePriceId, stripePaymentLink } = p;
  const cents = priceCents(p.price);

  // Check Stripe cache before creating anything — prevents duplicates on every build
  const cached = cache[String(p.id)];
  if (cached) {
    stripeProductId = stripeProductId || cached.stripeProductId;
    stripePaymentLink = stripePaymentLink || cached.stripePaymentLink;
  }

  if (!stripeProductId) {
    const prod = await stripe('POST', 'products', {
      name: p.name,
      description: p.desc,
      'metadata[site_id]': String(p.id),
      'metadata[img]': p.img,
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

  // Always verify the existing price matches the desired amount — update if not
  const existingPriceResult = await stripe('GET', 'prices', { product: stripeProductId, limit: 1, active: 'true' });
  const existingPrice = existingPriceResult.data.length > 0 ? existingPriceResult.data[0] : null;

  if (existingPrice && existingPrice.unit_amount === cents) {
    stripePriceId = existingPrice.id;
  } else {
    if (existingPrice) {
      // Deactivate old price so it no longer appears on payment links
      await stripe('POST', `prices/${existingPrice.id}`, { active: 'false' });
      console.log(`  $ Price updated (${existingPrice.unit_amount}¢ → ${cents}¢) for: ${p.name}`);
      stripePaymentLink = null; // force a new payment link with the correct price
    }
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
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': 'https://darkfantasyaiart.com/thank-you.html',
    });
    stripePaymentLink = link.url;
    // Save payment link URL into product metadata so future builds can retrieve it
    await stripe('POST', `products/${stripeProductId}`, {
      'metadata[payment_link]': stripePaymentLink,
    });
  }

  return { ...p, stripeProductId, stripePriceId, stripePaymentLink };
}

async function main() {
  const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
  console.log(`\nSyncing ${products.length} products to Stripe...\n`);

  // Build cache of existing Stripe products to avoid creating duplicates
  console.log('Checking existing Stripe products...');
  const cache = await buildStripeCache();
  console.log(`Found ${Object.keys(cache).length} existing products in Stripe.\n`);

  const updated = [];
  const newProducts = []; // track genuinely new products for TikTok

  for (const p of products) {
    try {
      const isNew = !cache[String(p.id)] && !p.stripeProductId;
      const result = await syncProduct(p, cache);
      updated.push(result);
      if (isNew) newProducts.push(result);
    } catch (err) {
      console.error(`  ERROR ${p.name}: ${err.message}`);
      updated.push(p);
    }
  }

  fs.writeFileSync('products.json', JSON.stringify(updated, null, 2));

  // Inject products array directly into index.html so no fetch is needed
  const html = fs.readFileSync('index.html', 'utf8');
  const injection = `products = ${JSON.stringify([...updated].reverse())};\nbuildGrid();\nbuildGallery();\ncheckDeepLink();`;

  // Build Schema.org ItemList + Product structured data for Google rich results
  const schemaProducts = updated.map((p, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Product',
      '@id': `https://darkfantasyaiart.com/#product-${p.id}`,
      name: p.name,
      description: p.desc,
      image: `https://darkfantasyaiart.com/${p.img}`,
      url: `https://darkfantasyaiart.com/#product-${p.id}`,
      category: p.tag,
      brand: { '@type': 'Person', name: 'Drew' },
      offers: {
        '@type': 'Offer',
        price: p.price.replace('$', ''),
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'Person', name: 'Drew' }
      }
    }
  }));

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: "Drew's Beginning — Dark Fantasy AI Art",
    description: 'Full collection of dark fantasy AI art available as instant digital downloads.',
    url: 'https://darkfantasyaiart.com/',
    numberOfItems: updated.length,
    itemListElement: schemaProducts
  };

  const schemaTag = `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
  const patched = html
    .replace('/* __PRODUCTS_INJECT__ */', injection)
    .replace('/* __SCHEMA_INJECT__ */', schemaTag);
  fs.writeFileSync('index.html', patched);

  // ── VIP Access product sync ──────────────────────────────────────────────
  console.log('\nSyncing VIP Access product...');
  const vipConfig = {
    name: "Drew's Secret Vault — VIP Access",
    desc: "Unlock exclusive members-only content on darkfantasyaiart.com. Instant access granted via email.",
    price: 1500, // $15.00 in cents
    album: 'vault',
  };

  // Check if VIP product already exists
  let vipProductId = null;
  let vipPriceId = null;
  let vipPaymentLink = null;

  const allProducts = await stripe('GET', 'products', { limit: 100 });
  for (const prod of allProducts.data) {
    if (prod.metadata && prod.metadata.type === 'vip_access' && prod.metadata.album === vipConfig.album) {
      vipProductId = prod.id;
      vipPaymentLink = prod.metadata.payment_link || null;
      break;
    }
  }

  if (!vipProductId) {
    const prod = await stripe('POST', 'products', {
      name: vipConfig.name,
      description: vipConfig.desc,
      'metadata[type]': 'vip_access',
      'metadata[album]': vipConfig.album,
    });
    vipProductId = prod.id;
    console.log(`  + Created VIP product: ${vipProductId}`);
  } else {
    console.log(`  ~ VIP product already exists: ${vipProductId}`);
  }

  if (!vipPriceId) {
    const prices = await stripe('GET', 'prices', { product: vipProductId, limit: 1, active: 'true' });
    if (prices.data.length > 0) {
      vipPriceId = prices.data[0].id;
    } else {
      const price = await stripe('POST', 'prices', {
        product: vipProductId,
        unit_amount: vipConfig.price,
        currency: 'usd',
      });
      vipPriceId = price.id;
    }
  }

  if (!vipPaymentLink) {
    const link = await stripe('POST', 'payment_links', {
      'line_items[0][price]': vipPriceId,
      'line_items[0][quantity]': 1,
      'after_completion[type]': 'redirect',
      'after_completion[redirect][url]': 'https://darkfantasyaiart.com/thank-you.html',
    });
    vipPaymentLink = link.url;
    await stripe('POST', `products/${vipProductId}`, {
      'metadata[payment_link]': vipPaymentLink,
    });
    console.log(`  + VIP payment link created: ${vipPaymentLink}`);
  } else {
    console.log(`  ~ VIP payment link exists: ${vipPaymentLink}`);
  }

  // Inject VIP payment link into index.html
  const htmlWithVip = fs.readFileSync('index.html', 'utf8');
  const patchedWithVip = htmlWithVip.replace('/* __VIP_PAYMENT_LINK__ */', `"${vipPaymentLink}"`);
  fs.writeFileSync('index.html', patchedWithVip);

  // Post any new products to TikTok
  await postNewProductsToTikTok(newProducts);

  console.log('\nDone. products.json updated and index.html patched with Stripe payment links.\n');
}

main().catch(err => { console.error(err.message); process.exit(1); });

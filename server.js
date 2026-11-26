'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3001;
const ROOT = __dirname;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const MAX_BODY = 8 * 1024 * 1024;
const sessions = new Map();
const loginAttempts = new Map();
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function assertEnvironment() {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL)) throw new Error('Configurá SUPABASE_URL con la URL de tu proyecto Supabase.');
  if (!SUPABASE_KEY) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY. Configurala como secreto del servidor, nunca en el navegador.');
  if (ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD debe tener al menos 12 caracteres.');
  if (SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres aleatorios.');
}

async function supabase(pathname, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(body === undefined || Buffer.isBuffer(body) ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data && (data.message || data.error_description || data.error) || `Supabase respondió ${response.status}.`;
    const error = new Error(message);
    error.status = response.status === 404 ? 404 : response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  return data;
}

async function table(name, params = {}, options = {}) {
  const query = new URLSearchParams(params).toString();
  return supabase(`/rest/v1/${name}${query ? `?${query}` : ''}`, options);
}

async function getStore() {
  const [settingsRows, categoryRows, productRows, promotionRows] = await Promise.all([
    table('store_settings', { select: '*', id: 'eq.default', limit: '1' }),
    table('categories', { select: 'name', order: 'name.asc' }),
    table('products', { select: '*', order: 'created_at.desc' }),
    table('promotions', { select: '*', order: 'created_at.desc' }),
  ]);
  if (!settingsRows.length) {
    throw Object.assign(new Error('La base está conectada, pero falta inicializarla. Ejecutá supabase/schema.sql en el SQL Editor de tu proyecto.'), { status: 503 });
  }
  return {
    settings: settingsRows[0],
    categories: categoryRows.map((row) => row.name),
    products: productRows.map(productFromRow),
    promotions: promotionRows.map(promotionFromRow),
  };
}

function productFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || '',
    description: row.description || '',
    notes: row.notes || '',
    images: row.image_urls || [],
    retail: { price: Number(row.retail_price), stock: row.retail_stock },
    wholesale: { price: Number(row.wholesale_price), stock: row.wholesale_stock, minimum: row.wholesale_minimum },
    createdAt: row.created_at,
  };
}

function promotionFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code || '',
    percent: Number(row.percent),
    active: row.active,
    mode: row.mode,
    category: row.category || '',
    productId: row.product_id || '',
    minimum: Number(row.minimum),
  };
}

function safeProduct(product) {
  if (!product || typeof product.name !== 'string' || !product.name.trim()) throw Object.assign(new Error('El producto necesita un nombre.'), { status: 400 });
  const id = product.id || crypto.randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw Object.assign(new Error('El identificador del producto no es válido.'), { status: 400 });
  const images = Array.isArray(product.images) ? product.images : product.image ? [product.image] : [];
  const publicImagePrefix = `${SUPABASE_URL}/storage/v1/object/public/product-images/`;
  const imagePattern = new RegExp(`^${publicImagePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-f0-9-]{36}\\.(webp|jpg|png)$`, 'i');
  if (images.length > 5 || images.some((image) => typeof image !== 'string' || !imagePattern.test(image))) {
    throw Object.assign(new Error('La imagen debe estar alojada en el almacenamiento de esta tienda.'), { status: 400 });
  }
  const price = (value) => {
    const parsed = Number(value) || 0;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2147483647) throw Object.assign(new Error('El precio debe ser un importe válido.'), { status: 400 });
    return Math.round(parsed);
  };
  const stock = (value) => {
    const parsed = Number(value) || 0;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2147483647) throw Object.assign(new Error('El stock debe ser una cantidad válida.'), { status: 400 });
    return Math.floor(parsed);
  };
  return {
    id,
    name: product.name.trim().slice(0, 100),
    category: String(product.category || '').trim().slice(0, 60),
    description: String(product.description || '').trim().slice(0, 600),
    notes: String(product.notes || '').trim().slice(0, 160),
    images,
    retail: { price: price(product.retail && product.retail.price), stock: stock(product.retail && product.retail.stock) },
    wholesale: { price: price(product.wholesale && product.wholesale.price), stock: stock(product.wholesale && product.wholesale.stock), minimum: Math.max(1, stock(product.wholesale && product.wholesale.minimum) || 1) },
    createdAt: product.createdAt || new Date().toISOString(),
  };
}

function productToRow(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category || null,
    description: product.description,
    notes: product.notes,
    image_urls: product.images,
    retail_price: product.retail.price,
    retail_stock: product.retail.stock,
    wholesale_price: product.wholesale.price,
    wholesale_stock: product.wholesale.stock,
    wholesale_minimum: product.wholesale.minimum,
  };
}

function safePromotion(promo) {
  if (!promo || typeof promo.name !== 'string' || !promo.name.trim()) throw Object.assign(new Error('La promoción necesita un nombre.'), { status: 400 });
  const percent = Number(promo.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 90) throw Object.assign(new Error('El descuento debe estar entre 1% y 90%.'), { status: 400 });
  const productId = String(promo.productId || '');
  if (productId && !/^[a-f0-9-]{36}$/i.test(productId)) throw Object.assign(new Error('El producto de la promoción no es válido.'), { status: 400 });
  return {
    id: promo.id || crypto.randomUUID(),
    name: promo.name.trim().slice(0, 100),
    code: String(promo.code || '').trim().toUpperCase().slice(0, 24) || null,
    percent,
    active: Boolean(promo.active),
    mode: ['retail', 'wholesale', 'all'].includes(promo.mode) ? promo.mode : 'all',
    category: String(promo.category || '').trim().slice(0, 60) || null,
    product_id: productId || null,
    minimum: Math.floor(Math.max(0, Number(promo.minimum) || 0)),
  };
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) {
        reject(Object.assign(new Error('La solicitud es demasiado grande.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(Object.assign(new Error('El formato de la solicitud no es válido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function sessionToken(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)perfumeria_session=([a-f0-9]+\.[a-f0-9]+)/);
  if (!match) return null;
  const [expires, signature] = match[1].split('.');
  if (Number(expires) < Date.now()) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(expires).digest('hex');
  const actualBytes = Buffer.from(signature, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return sessions.has(match[1]) && actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes) ? match[1] : null;
}

function requireAdmin(req, res) {
  if (sessionToken(req)) return true;
  sendJson(res, 401, { error: 'Iniciá sesión como administrador para continuar.' });
  return false;
}

function queryString(params) {
  return new URLSearchParams(params).toString();
}

async function categories() {
  const rows = await table('categories', { select: 'name', order: 'name.asc' });
  return rows.map((row) => row.name);
}

async function handleAdmin(req, res, pathname) {
  if (!requireAdmin(req, res)) return;
  const productMatch = pathname.match(/^\/api\/admin\/products\/([a-f0-9-]{36})$/i);
  if (pathname === '/api/admin/products' && req.method === 'POST') {
    const product = safeProduct(await readBody(req));
    const [created] = await table('products', {}, { method: 'POST', body: productToRow(product), headers: { Prefer: 'return=representation' } });
    return sendJson(res, 201, productFromRow(created));
  }
  if (productMatch) {
    const filter = queryString({ id: `eq.${productMatch[1]}`, select: '*' });
    if (req.method === 'PATCH') {
      const current = await table('products', { id: `eq.${productMatch[1]}`, select: '*' });
      if (!current.length) return sendJson(res, 404, { error: 'No encontramos ese producto.' });
      const product = safeProduct({ ...productFromRow(current[0]), ...(await readBody(req)), id: productMatch[1], createdAt: current[0].created_at });
      const [updated] = await table(`products?${filter}`, {}, { method: 'PATCH', body: productToRow(product), headers: { Prefer: 'return=representation' } });
      return sendJson(res, 200, productFromRow(updated));
    }
    if (req.method === 'DELETE') {
      const removed = await table(`products?${queryString({ id: `eq.${productMatch[1]}`, select: 'id' })}`, {}, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      if (!removed.length) return sendJson(res, 404, { error: 'No encontramos ese producto.' });
      return sendJson(res, 200, { ok: true });
    }
  }
  if (pathname === '/api/admin/categories' && req.method === 'POST') {
    const { name } = await readBody(req);
    const normalized = String(name || '').trim().slice(0, 60);
    if (!normalized) return sendJson(res, 400, { error: 'Escribí un nombre para la categoría.' });
    const existing = await table('categories', { select: 'name' });
    if (existing.some((entry) => entry.name.toLowerCase() === normalized.toLowerCase())) return sendJson(res, 409, { error: 'Esa categoría ya existe.' });
    const [created] = await table('categories', {}, { method: 'POST', body: { name: normalized }, headers: { Prefer: 'return=representation' } });
    return sendJson(res, 201, { categories: [...existing.map((entry) => entry.name), created.name].sort((a, b) => a.localeCompare(b, 'es')) });
  }
  const categoryMatch = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
  if (categoryMatch && ['PATCH', 'DELETE'].includes(req.method)) {
    const currentCategories = await categories();
    const index = Number(categoryMatch[1]);
    const oldName = currentCategories[index];
    if (!oldName) return sendJson(res, 404, { error: 'No encontramos esa categoría.' });
    if (req.method === 'PATCH') {
      const { name } = await readBody(req);
      const newName = String(name || '').trim().slice(0, 60);
      if (!newName) return sendJson(res, 400, { error: 'Escribí un nombre para la categoría.' });
      if (currentCategories.some((entry) => entry.toLowerCase() === newName.toLowerCase() && entry !== oldName)) return sendJson(res, 409, { error: 'Esa categoría ya existe.' });
      await supabase('/rest/v1/rpc/rename_store_category', { method: 'POST', body: { p_old: oldName, p_new: newName } });
    } else {
      await supabase('/rest/v1/rpc/delete_store_category', { method: 'POST', body: { p_name: oldName } });
    }
    return sendJson(res, 200, { categories: await categories() });
  }
  if (pathname === '/api/admin/promotions' && req.method === 'POST') {
    const promo = safePromotion(await readBody(req));
    const [created] = await table('promotions', {}, { method: 'POST', body: promo, headers: { Prefer: 'return=representation' } });
    return sendJson(res, 201, promotionFromRow(created));
  }
  const promoMatch = pathname.match(/^\/api\/admin\/promotions\/([a-f0-9-]{36})$/i);
  if (promoMatch) {
    const filter = { id: `eq.${promoMatch[1]}`, select: '*' };
    if (req.method === 'PATCH') {
      const rows = await table('promotions', filter);
      if (!rows.length) return sendJson(res, 404, { error: 'No encontramos esa promoción.' });
      const promo = safePromotion({ ...promotionFromRow(rows[0]), ...(await readBody(req)), id: promoMatch[1] });
      const [updated] = await table(`promotions?${queryString(filter)}`, {}, { method: 'PATCH', body: promo, headers: { Prefer: 'return=representation' } });
      return sendJson(res, 200, promotionFromRow(updated));
    }
    if (req.method === 'DELETE') {
      const removed = await table(`promotions?${queryString(filter)}`, {}, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
      if (!removed.length) return sendJson(res, 404, { error: 'No encontramos esa promoción.' });
      return sendJson(res, 200, { ok: true });
    }
  }
  if (pathname === '/api/admin/settings' && req.method === 'PATCH') {
    const incoming = await readBody(req);
    const current = await table('store_settings', { select: '*', id: 'eq.default', limit: '1' });
    if (!current.length) return sendJson(res, 503, { error: 'Falta configurar la fila inicial de la tienda en Supabase.' });
    const allowed = {};
    for (const key of ['name', 'tagline', 'whatsapp']) {
      if (typeof incoming[key] === 'string') allowed[key] = incoming[key].trim().slice(0, key === 'tagline' ? 120 : 100);
    }
    for (const key of ['accent', 'background', 'ink']) {
      if (typeof incoming[key] === 'string' && /^#[0-9a-f]{6}$/i.test(incoming[key])) allowed[key] = incoming[key];
    }
    if (typeof incoming.avatar === 'string') {
      const prefix = `${SUPABASE_URL}/storage/v1/object/public/product-images/`;
      if (!incoming.avatar || new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-f0-9-]{36}\\.(webp|jpg|png)$`, 'i').test(incoming.avatar)) allowed.avatar_url = incoming.avatar || null;
      else return sendJson(res, 400, { error: 'La imagen de perfil debe estar alojada en el almacenamiento de esta tienda.' });
    }
    const [updated] = await table(`store_settings?${queryString({ id: 'eq.default', select: '*' })}`, {}, { method: 'PATCH', body: allowed, headers: { Prefer: 'return=representation' } });
    return sendJson(res, 200, updated);
  }
  if (pathname === '/api/admin/image' && req.method === 'POST') {
    const body = await readBody(req);
    const match = typeof body.data === 'string' && body.data.match(/^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1] !== body.type) return sendJson(res, 400, { error: 'Usá una imagen JPG, PNG o WebP.' });
    const extension = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[body.type];
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) return sendJson(res, 413, { error: 'La imagen optimizada debe pesar menos de 3 MB.' });
    const filename = `${crypto.randomUUID()}.${extension}`;
    await supabase(`/storage/v1/object/product-images/${filename}`, {
      method: 'POST',
      body: buffer,
      headers: { 'Content-Type': body.type, 'x-upsert': 'false' },
    });
    return sendJson(res, 201, { image: `${SUPABASE_URL}/storage/v1/object/public/product-images/${filename}` });
  }
  return sendJson(res, 404, { error: 'No encontramos esa ruta.' });
}

async function handleOrder(req, res) {
  const body = await readBody(req);
  if (!Array.isArray(body.items) || !body.items.length) return sendJson(res, 400, { error: 'El carrito está vacío.' });
  if (!body.customer || !String(body.customer.name || '').trim() || !String(body.customer.contact || '').trim()) {
    return sendJson(res, 400, { error: 'Completá tu nombre y un medio de contacto.' });
  }
  const items = new Map();
  for (const entry of body.items) {
    if (!/^[a-f0-9-]{36}$/i.test(String(entry.id || '')) || !['retail', 'wholesale'].includes(entry.mode)) return sendJson(res, 400, { error: 'Revisá los productos del pedido.' });
    const quantity = Math.floor(Number(entry.quantity));
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) return sendJson(res, 400, { error: 'La cantidad del pedido no es válida.' });
    const key = `${entry.id}:${entry.mode}`;
    const combined = (items.get(key)?.quantity || 0) + quantity;
    if (combined > 10000) return sendJson(res, 400, { error: 'La cantidad máxima por producto es 10.000 unidades.' });
    items.set(key, { id: entry.id, mode: entry.mode, quantity: combined });
  }
  const result = await supabase('/rest/v1/rpc/place_store_order', {
    method: 'POST',
    body: {
      p_order: {
        items: [...items.values()].sort((left, right) => left.id.localeCompare(right.id) || left.mode.localeCompare(right.mode)),
        coupon: String(body.coupon || '').trim().toUpperCase(),
        customer: { name: String(body.customer.name).trim().slice(0, 100), contact: String(body.customer.contact).trim().slice(0, 100) },
        delivery: String(body.delivery || 'A coordinar').slice(0, 100),
        payment: String(body.payment || 'A coordinar').slice(0, 100),
      },
    },
  });
  if (result && result.error) return sendJson(res, result.status || 400, { error: result.error });
  result.order.createdAt = result.order.created_at;
  return sendJson(res, 201, result);
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  if (pathname === '/api/store' && req.method === 'GET') {
    const store = await getStore();
    return sendJson(res, 200, {
      settings: {
        name: store.settings.name,
        tagline: store.settings.tagline,
        accent: store.settings.accent,
        background: store.settings.background,
        ink: store.settings.ink,
        avatar: store.settings.avatar_url || '',
        whatsapp: store.settings.whatsapp || '',
      },
      categories: store.categories,
      products: store.products,
      promotions: store.promotions,
    });
  }
  if (pathname === '/api/admin/session' && req.method === 'GET') return sendJson(res, 200, { authenticated: Boolean(sessionToken(req)) });
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || 'local';
    const attempts = (loginAttempts.get(ip) || []).filter((time) => Date.now() - time < 5 * 60 * 1000);
    if (attempts.length >= 8) return sendJson(res, 429, { error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' });
    const body = await readBody(req);
    const candidate = await scrypt(String(body.password || ''), SESSION_SECRET, 64);
    const expected = await scrypt(ADMIN_PASSWORD, SESSION_SECRET, 64);
    if (!crypto.timingSafeEqual(candidate, expected)) {
      attempts.push(Date.now());
      loginAttempts.set(ip, attempts);
      return sendJson(res, 401, { error: 'La contraseña no es correcta.' });
    }
    loginAttempts.delete(ip);
    const expires = String(Date.now() + 8 * 60 * 60 * 1000);
    const signature = crypto.createHmac('sha256', SESSION_SECRET).update(expires).digest('hex');
    const token = `${expires}.${signature}`;
    sessions.set(token, true);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `perfumeria_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` });
  }
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const token = sessionToken(req);
    if (token) sessions.delete(token);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `perfumeria_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}` });
  }
  if (pathname.startsWith('/api/admin/')) return handleAdmin(req, res, pathname);
  if (pathname === '/api/orders' && req.method === 'POST') return handleOrder(req, res);
  return sendJson(res, 404, { error: 'No encontramos esa ruta.' });
}

function serveStatic(res, pathname) {
  let file;
  if (pathname === '/') file = path.join(ROOT, 'index.html');
  else if (pathname === '/style.css' || pathname === '/app.js') file = path.join(ROOT, path.basename(pathname));
  else {
    res.writeHead(404).end('No encontrado');
    return;
  }
  fs.readFile(file, (error, content) => {
    if (error) return res.writeHead(404).end('No encontrado');
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' https://*.supabase.co data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    res.end(content);
  });
}

async function main() {
  assertEnvironment();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers.origin) {
          const origin = new URL(req.headers.origin);
          if (origin.host !== req.headers.host) return sendJson(res, 403, { error: 'Origen de solicitud no permitido.' });
        }
        await handleApi(req, res, url);
      } else if (req.method === 'GET') serveStatic(res, decodeURIComponent(url.pathname));
      else sendJson(res, 405, { error: 'Método no permitido.' });
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'Ocurrió un error interno. Revisá los registros del servidor.' });
    }
  });
  server.listen(PORT, '0.0.0.0', () => console.log(`Casa Ámbar está lista en el puerto ${PORT}. Catálogo e imágenes: Supabase.`));
}

main().catch((error) => {
  console.error('No se pudo iniciar la tienda:', error.message);
  process.exitCode = 1;
});

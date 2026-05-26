const { createHash, randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');

// ── JWT ──
let jwt;
try { jwt = require('jsonwebtoken'); } catch { 
  // 如果没有安装 jsonwebtoken，用内联实现（dev 环境）
}

const JWT_SECRET = process.env.JWT_SECRET || 'zcx-secret-' + Date.now();

function signToken(user) {
  if (jwt) return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  // 简易 token（仅开发用）
  const payload = Buffer.from(JSON.stringify({ id: user.id, email: user.email, name: user.name, exp: Date.now() + 7*86400000 })).toString('base64');
  return `zcx_${payload}`;
}

function verifyToken(token) {
  if (jwt) return jwt.verify(token, JWT_SECRET);
  // 简易验证
  if (!token.startsWith('zcx_')) throw new Error('invalid token');
  const payload = JSON.parse(Buffer.from(token.slice(4), 'base64').toString());
  if (payload.exp < Date.now()) throw new Error('expired');
  return payload;
}

// ── 文件数据库 ──
const DB_DIR = '/tmp/zcxdb';
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function readTable(name) {
  const p = path.join(DB_DIR, `${name}.json`);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}
function writeTable(name, data) {
  fs.writeFileSync(path.join(DB_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// 初始化
if (!fs.existsSync(path.join(DB_DIR, 'users.json'))) {
  writeTable('users', []);
  writeTable('orders', []);
}

// ── 工具 ──
function hashPw(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: createHash('sha256').update(salt + pw).digest('hex') };
}
function verifyPw(pw, salt, hash) {
  return hashPw(pw, salt).hash === hash;
}
function genId(p = '') {
  return p + Date.now().toString(36).toUpperCase() + randomBytes(3).toString('hex').toUpperCase();
}

const UNIT_PRICE = 1999;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

function auth(req) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = verifyToken(authHeader.slice(7));
    const users = readTable('users');
    return users.find(u => u.id === decoded.id) || null;
  } catch { return null; }
}

// ── HTTP 路由 ──
async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathname = url.pathname.replace(/^\/api/, '') || '/';

  // CORS preflight
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    // ── POST /auth/register ──
    if (pathname === '/auth/register' && method === 'POST') {
      const { name, email, phone, password } = await req.json();
      if (!name || !email || !phone || !password) return json({ error: '请填写所有必填字段' }, 400);
      const users = readTable('users');
      if (users.find(u => u.email === email)) return json({ error: '该邮箱已被注册' }, 409);
      const { salt, hash } = hashPw(password);
      const user = { id: genId('U'), name, email, phone, salt, hash, createdAt: new Date().toISOString() };
      users.push(user);
      writeTable('users', users);
      return json({ message: '注册成功', token: signToken(user), user: { id: user.id, name: user.name, email: user.email } }, 201);
    }

    // ── POST /auth/login ──
    if (pathname === '/auth/login' && method === 'POST') {
      const { email, password } = await req.json();
      if (!email || !password) return json({ error: '请填写邮箱和密码' }, 400);
      const users = readTable('users');
      const user = users.find(u => u.email === email);
      if (!user || !verifyPw(password, user.salt, user.hash)) return json({ error: '邮箱或密码错误' }, 401);
      return json({ message: '登录成功', token: signToken(user), user: { id: user.id, name: user.name, email: user.email } });
    }

    // ── POST /orders ──
    if (pathname === '/orders' && method === 'POST') {
      const user = auth(req);
      if (!user) return json({ error: '未登录' }, 401);
      const { name, phone, address, note, quantity } = await req.json();
      if (!name || !phone || !address) return json({ error: '请填写完整的收货信息' }, 400);
      const qty = Math.max(1, Math.min(99, parseInt(quantity) || 1));
      const order = {
        id: genId('ZCX'), userId: user.id, userName: user.name, userEmail: user.email,
        product: '知诚星辰 · 陪伴版', quantity: qty, unitPrice: UNIT_PRICE, totalPrice: qty * UNIT_PRICE,
        receiver: { name, phone, address }, note: note || '', status: 'pending', payment: null,
        createdAt: new Date().toISOString(),
      };
      const orders = readTable('orders');
      orders.push(order);
      writeTable('orders', orders);
      return json({ message: '订单创建成功', order: { id: order.id, total: order.totalPrice, status: order.status } }, 201);
    }

    // ── GET /orders ──
    if (pathname === '/orders' && method === 'GET') {
      const user = auth(req);
      if (!user) return json({ error: '未登录' }, 401);
      const orders = readTable('orders').filter(o => o.userId === user.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return json({ orders });
    }

    // ── POST /payment/alipay ──
    if (pathname === '/payment/alipay' && method === 'POST') {
      const user = auth(req);
      if (!user) return json({ error: '未登录' }, 401);
      const { orderId } = await req.json();
      const orders = readTable('orders');
      const order = orders.find(o => o.id === orderId && o.userId === user.id);
      if (!order) return json({ error: '订单不存在' }, 404);
      if (order.status !== 'pending') return json({ error: '订单已支付或已取消' }, 400);
      order.payment = { method: 'alipay', tradeNo: genId('ALI'), status: 'pending' };
      writeTable('orders', orders);
      return json({ message: '支付单已创建', payment: { tradeNo: order.payment.tradeNo, amount: order.totalPrice } });
    }

    // ── POST /payment/wechat ──
    if (pathname === '/payment/wechat' && method === 'POST') {
      const user = auth(req);
      if (!user) return json({ error: '未登录' }, 401);
      const { orderId } = await req.json();
      const orders = readTable('orders');
      const order = orders.find(o => o.id === orderId && o.userId === user.id);
      if (!order) return json({ error: '订单不存在' }, 404);
      if (order.status !== 'pending') return json({ error: '订单已支付或已取消' }, 400);
      order.payment = { method: 'wechat', tradeNo: genId('WX'), status: 'pending' };
      writeTable('orders', orders);
      return json({ message: '支付单已创建', payment: { tradeNo: order.payment.tradeNo, amount: order.totalPrice } });
    }

    // ── POST /payment/confirm ──
    if (pathname === '/payment/confirm' && method === 'POST') {
      const user = auth(req);
      if (!user) return json({ error: '未登录' }, 401);
      const { orderId } = await req.json();
      const orders = readTable('orders');
      const order = orders.find(o => o.id === orderId && o.userId === user.id);
      if (!order) return json({ error: '订单不存在' }, 404);
      if (order.status !== 'pending') return json({ error: '订单状态异常' }, 400);
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
      if (order.payment) order.payment.status = 'paid';
      writeTable('orders', orders);
      return json({ message: '支付确认成功', order: { id: order.id, status: 'paid' } });
    }

    // ── GET /me ──
    if (pathname === '/me' && method === 'GET') {
      const user = auth(req);
      if (!user) return json({ error: '未登录' }, 401);
      return json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
    }

    // ── GET /health ──
    if (pathname === '/health') {
      return json({ status: 'ok', uptime: process.uptime() });
    }

    return json({ error: 'Not found' }, 404);

  } catch (e) {
    return json({ error: e.message || '服务器错误' }, 500);
  }
}

// ── Vercel Serverless Export ──
module.exports = handler;

// ── 本地开发 ──
if (require.main === module) {
  const http = require('http');
  const server = http.createServer(async (req, res) => {
    // 转换为 Web API Request
    const body = await new Promise(r => { let d = []; req.on('data', c => d.push(c)); req.on('end', () => r(Buffer.concat(d).toString())); });
    const webReq = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: req.method !== 'GET' && req.method !== 'OPTIONS' ? body : undefined,
    });
    const webRes = await handler(webReq);
    res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
    res.end(await webRes.text());
  });
  server.listen(3001, () => console.log('API server: http://localhost:3001'));
}

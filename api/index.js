const { createHash, randomBytes } = require('crypto');

// ── 懒加载工具函数 ──
let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const { Pool } = require('pg');
    _pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
  } catch (e) { console.error('pg init:', e.message); }
  return _pool;
}

async function query(sql, params) {
  const p = getPool();
  if (!p) throw new Error('数据库未连接');
  return p.query(sql, params);
}

let _mailer = null;
function getMailer() {
  if (_mailer) return _mailer;
  const u = process.env.GMAIL_USER, p = process.env.GMAIL_APP_PASSWORD;
  if (!u || !p) return null;
  try {
    const nm = require('nodemailer');
    _mailer = nm.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: u, pass: p } });
  } catch (e) { console.error('mailer init:', e.message); }
  return _mailer;
}

let _jwt = null;
function getJwt() {
  if (_jwt) return _jwt;
  try { _jwt = require('jsonwebtoken'); } catch {}
  return _jwt;
}

const JWT_SECRET = process.env.JWT_SECRET || 'zcx-' + Date.now();

function sign(u) {
  const j = getJwt();
  if (j) return j.sign({ id: u.id, email: u.email, name: u.name }, JWT_SECRET, { expiresIn: '7d' });
  return 'zcx_' + Buffer.from(JSON.stringify({ id: u.id, email: u.email, name: u.name, exp: Date.now() + 7*86400000 })).toString('base64');
}
function verify(t) {
  const j = getJwt();
  if (j) return j.verify(t, JWT_SECRET);
  const payload = JSON.parse(Buffer.from(t.slice(4), 'base64').toString());
  if (payload.exp < Date.now()) throw new Error('expired');
  return payload;
}

function hashPw(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: createHash('sha256').update(salt + pw).digest('hex') };
}
function genId(p = '') {
  return p + Date.now().toString(36).toUpperCase() + randomBytes(3).toString('hex').toUpperCase();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let body = {};
  if (req.method === 'POST' && req.headers['content-type']?.includes('json')) {
    try {
      body = await new Promise((resolve) => {
        let d = [];
        req.on('data', c => d.push(c));
        req.on('end', () => resolve(JSON.parse(Buffer.concat(d).toString())));
      });
    } catch { return res.status(400).json({ error: '无效的请求数据' }); }
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api/, '') || '/';

  function currentUser() {
    const h = req.headers['authorization'];
    if (!h || !h.startsWith('Bearer ')) return null;
    try { return verify(h.slice(7)); } catch { return null; }
  }

  try {
    // Auto-create tables on first DB query
    if (getPool()) {
      await query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`).catch(() => {});
      await query(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), product TEXT NOT NULL DEFAULT '知诚星辰 · 陪伴版', quantity INTEGER NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 1999, total_price INTEGER NOT NULL, receiver_name TEXT NOT NULL, receiver_phone TEXT NOT NULL, receiver_address TEXT NOT NULL, note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT, payment_trade_no TEXT, payment_status TEXT, created_at TIMESTAMP DEFAULT NOW(), paid_at TIMESTAMP, shipped_at TIMESTAMP, delivered_at TIMESTAMP)`).catch(() => {});
      await query(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`).catch(() => {});
      await query(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`).catch(() => {});
    }

    // ── POST /auth/register ──
    if (path === '/auth/register' && req.method === 'POST') {
      const { name, email, phone, password } = body;
      if (!name || !email || !phone || !password) return res.status(400).json({ error: '请填写所有必填字段' });
      const exist = await query('SELECT id FROM users WHERE email=$1', [email]);
      if (exist.rows.length) return res.status(409).json({ error: '该邮箱已被注册' });
      const { salt, hash } = hashPw(password);
      const id = genId('U');
      await query('INSERT INTO users(id,name,email,phone,salt,hash) VALUES($1,$2,$3,$4,$5,$6)', [id, name, email, phone, salt, hash]);
      return res.status(201).json({ message: '注册成功', token: sign({ id, name, email }), user: { id, name, email } });
    }

    // ── POST /auth/login ──
    if (path === '/auth/login' && req.method === 'POST') {
      const { email, password } = body;
      if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });
      const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
      if (!rows.length || hashPw(password, rows[0].salt).hash !== rows[0].hash) return res.status(401).json({ error: '邮箱或密码错误' });
      const u = rows[0];
      return res.json({ message: '登录成功', token: sign(u), user: { id: u.id, name: u.name, email: u.email } });
    }

    // ── POST /orders ──
    if (path === '/orders' && req.method === 'POST') {
      const user = currentUser(); if (!user) return res.status(401).json({ error: '未登录' });
      const { name, phone, address, note, quantity } = body;
      if (!name || !phone || !address) return res.status(400).json({ error: '请填写完整的收货信息' });
      const qty = Math.max(1, Math.min(99, parseInt(quantity) || 1));
      const oid = genId('ZCX');
      await query('INSERT INTO orders(id,user_id,quantity,total_price,receiver_name,receiver_phone,receiver_address,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [oid, user.id, qty, qty * 1999, name, phone, address, note || '']);
      return res.status(201).json({ message: '订单创建成功', order: { id: oid, total: qty * 1999, status: 'pending' } });
    }

    // ── GET /orders ──
    if (path === '/orders' && req.method === 'GET') {
      const user = currentUser(); if (!user) return res.status(401).json({ error: '未登录' });
      const { rows } = await query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC', [user.id]);
      return res.json({ orders: rows });
    }

    // ── POST /payment/alipay ──
    if (path === '/payment/alipay' && req.method === 'POST') {
      const user = currentUser(); if (!user) return res.status(401).json({ error: '未登录' });
      const { orderId } = body;
      const { rows } = await query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, user.id]);
      if (!rows.length) return res.status(404).json({ error: '订单不存在' });
      if (rows[0].status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
      await query("UPDATE orders SET payment_method='alipay', payment_trade_no=$1, payment_status='pending' WHERE id=$2", [genId('ALI'), orderId]);
      return res.json({ message: '支付单已创建', payment: { amount: rows[0].total_price } });
    }

    // ── POST /payment/wechat ──
    if (path === '/payment/wechat' && req.method === 'POST') {
      const user = currentUser(); if (!user) return res.status(401).json({ error: '未登录' });
      const { orderId } = body;
      const { rows } = await query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, user.id]);
      if (!rows.length) return res.status(404).json({ error: '订单不存在' });
      if (rows[0].status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
      await query("UPDATE orders SET payment_method='wechat', payment_trade_no=$1, payment_status='pending' WHERE id=$2", [genId('WX'), orderId]);
      return res.json({ message: '支付单已创建', payment: { amount: rows[0].total_price } });
    }

    // ── POST /payment/confirm ──
    if (path === '/payment/confirm' && req.method === 'POST') {
      const user = currentUser(); if (!user) return res.status(401).json({ error: '未登录' });
      const { orderId } = body;
      const { rows } = await query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, user.id]);
      if (!rows.length) return res.status(404).json({ error: '订单不存在' });
      if (rows[0].status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
      await query("UPDATE orders SET status='paid', payment_status='paid', paid_at=NOW() WHERE id=$1", [orderId]);
      // send email in background
      try {
        const mailer = getMailer();
        if (mailer) {
          const o = rows[0];
          await mailer.sendMail({
            from: `"知诚星辰智能" <${process.env.GMAIL_USER}>`, to: user.email,
            subject: `🎉 订单确认 — ${o.id}`,
            html: `<div style="max-width:600px;margin:0 auto;background:#101018;color:#e8e8f0;padding:32px;border-radius:16px;font-family:sans-serif;">
              <h1 style="color:#a29bfe;text-align:center;">✦ 知诚星辰智能</h1>
              <p style="text-align:center;color:#9898b8;">让机器人拥有温度</p>
              <div style="background:#181825;border-radius:12px;padding:24px;margin:20px 0;">
                <h2 style="margin:0 0 16px;">✅ 支付成功！</h2>
                <table style="width:100%;font-size:14px;">
                  <tr><td style="color:#9898b8;padding:6px 0;">订单号</td><td style="color:#a29bfe;"><code>${o.id}</code></td></tr>
                  <tr><td style="color:#9898b8;padding:6px 0;">商品</td><td>${o.product} × ${o.quantity}</td></tr>
                  <tr><td style="color:#9898b8;padding:6px 0;">金额</td><td><strong>¥${Number(o.total_price).toLocaleString()}</strong></td></tr>
                  <tr><td style="color:#9898b8;padding:6px 0;">收货人</td><td>${o.receiver_name}</td></tr>
                  <tr><td style="color:#9898b8;padding:6px 0;">地址</td><td>${o.receiver_address}</td></tr>
                  <tr><td style="color:#9898b8;padding:6px 0;">支付</td><td>${o.payment_method === 'alipay' ? '💙 支付宝' : '💚 微信支付'}</td></tr>
                </table>
              </div>
              <p style="color:#9898b8;text-align:center;font-size:13px;">🚚 预计 7-15 个工作日发货</p>
              <hr style="border-color:#2a2a45;">
              <p style="color:#606080;text-align:center;font-size:12px;">知诚星辰智能（青岛）有限公司</p>
            </div>`,
          });
        }
      } catch (e) { console.error('mail err:', e.message); }
      return res.json({ message: '支付确认成功', order: { id: orderId, status: 'paid' } });
    }

    // ── GET /me ──
    if (path === '/me' && req.method === 'GET') {
      const user = currentUser(); if (!user) return res.status(401).json({ error: '未登录' });
      const { rows } = await query('SELECT id,name,email,phone FROM users WHERE id=$1', [user.id]);
      return res.json({ user: rows[0] || null });
    }

    // ── GET /health ──
    if (path === '/health') {
      let dbOk = false, dbTime = null;
      try { if (getPool()) { const r = await query('SELECT NOW() as t'); dbOk = true; dbTime = r.rows[0]?.t; } } catch {}
      return res.json({
        status: dbOk ? 'ok' : 'degraded',
        db: dbTime,
        db_connected: dbOk,
        env: { pg: !!process.env.POSTGRES_URL, gmail: !!process.env.GMAIL_USER, jwt: !!getJwt() },
        uptime: process.uptime(),
      });
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (e) {
    console.error('Error:', e.message, e.stack?.slice(0,200));
    return res.status(500).json({ error: e.message || '服务器错误' });
  }
};

const { Pool } = require('pg');
const { createHash, randomBytes } = require('crypto');
const nodemailer = require('nodemailer');

// ── 数据库 ──
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Gmail ──
let transporter = null;
function getMailer() {
  if (transporter) return transporter;
  const u = process.env.GMAIL_USER, p = process.env.GMAIL_APP_PASSWORD;
  if (!u || !p) return null;
  transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: u, pass: p } });
  return transporter;
}

async function sendOrderEmail(order, to) {
  const m = getMailer();
  if (!m) return;
  try {
    await m.sendMail({
      from: `"知诚星辰智能" <${process.env.GMAIL_USER}>`, to,
      subject: `🎉 订单确认 — ${order.id}`,
      html: `<div style="max-width:600px;margin:0 auto;font-family:sans-serif;background:#101018;color:#e8e8f0;padding:32px;border-radius:16px;">
        <h1 style="color:#a29bfe;text-align:center;">✦ 知诚星辰智能</h1>
        <p style="text-align:center;color:#9898b8;">让机器人拥有温度</p>
        <div style="background:#181825;border-radius:12px;padding:24px;margin:20px 0;">
          <h2 style="margin:0 0 16px;">✅ 支付成功！</h2>
          <table style="width:100%;font-size:14px;">
            <tr><td style="color:#9898b8;padding:6px 0;">订单号</td><td style="color:#a29bfe;"><code>${order.id}</code></td></tr>
            <tr><td style="color:#9898b8;padding:6px 0;">商品</td><td>${order.product} × ${order.quantity}</td></tr>
            <tr><td style="color:#9898b8;padding:6px 0;">金额</td><td><strong>¥${Number(order.total_price).toLocaleString()}</strong></td></tr>
            <tr><td style="color:#9898b8;padding:6px 0;">收货人</td><td>${order.receiver_name}</td></tr>
            <tr><td style="color:#9898b8;padding:6px 0;">地址</td><td>${order.receiver_address}</td></tr>
            <tr><td style="color:#9898b8;padding:6px 0;">支付</td><td>${order.payment_method === 'alipay' ? '💙 支付宝' : '💚 微信支付'}</td></tr>
          </table>
        </div>
        <p style="color:#9898b8;text-align:center;font-size:13px;">🚚 预计 7-15 个工作日发货</p>
        <hr style="border-color:#2a2a45;">
        <p style="color:#606080;text-align:center;font-size:12px;">知诚星辰智能（青岛）有限公司</p>
      </div>`,
    });
    console.log(`📧 邮件已发送至 ${to}`);
  } catch (e) { console.error('❌ 邮件失败:', e.message); }
}

// ── JWT ──
let jwt;
try { jwt = require('jsonwebtoken'); } catch {}
const JWT_SECRET = process.env.JWT_SECRET || 'zcx-' + Date.now();
function sign(u) {
  if (jwt) return jwt.sign({ id: u.id, email: u.email, name: u.name }, JWT_SECRET, { expiresIn: '7d' });
  return 'zcx_' + Buffer.from(JSON.stringify(u)).toString('base64');
}
function verify(t) {
  if (jwt) return jwt.verify(t, JWT_SECRET);
  return JSON.parse(Buffer.from(t.slice(4), 'base64').toString());
}

// ── 工具 ──
function hashPw(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: createHash('sha256').update(salt + pw).digest('hex') };
}
function genId(p = '') {
  return p + Date.now().toString(36).toUpperCase() + randomBytes(3).toString('hex').toUpperCase();
}

// ── 主处理 ──
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // 解析 body
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

  function auth() {
    const h = req.headers['authorization'];
    if (!h || !h.startsWith('Bearer ')) return null;
    try { return verify(h.slice(7)); } catch { return null; }
  }

  try {
    // ── 自动建表（首次请求时） ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW());
      CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), product TEXT NOT NULL DEFAULT '知诚星辰 · 陪伴版', quantity INTEGER NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 1999, total_price INTEGER NOT NULL, receiver_name TEXT NOT NULL, receiver_phone TEXT NOT NULL, receiver_address TEXT NOT NULL, note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT, payment_trade_no TEXT, payment_status TEXT, created_at TIMESTAMP DEFAULT NOW(), paid_at TIMESTAMP, shipped_at TIMESTAMP, delivered_at TIMESTAMP);
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    `).catch(() => {});

    // POST /auth/register
    if (path === '/auth/register' && req.method === 'POST') {
      const { name, email, phone, password } = body;
      if (!name || !email || !phone || !password) return res.status(400).json({ error: '请填写所有必填字段' });
      const exist = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
      if (exist.rows.length) return res.status(409).json({ error: '该邮箱已被注册' });
      const { salt, hash } = hashPw(password);
      const id = genId('U');
      await pool.query('INSERT INTO users(id,name,email,phone,salt,hash) VALUES($1,$2,$3,$4,$5,$6)', [id, name, email, phone, salt, hash]);
      return res.status(201).json({ message: '注册成功', token: sign({ id, name, email }), user: { id, name, email } });
    }

    // POST /auth/login
    if (path === '/auth/login' && req.method === 'POST') {
      const { email, password } = body;
      if (!email || !password) return res.status(400).json({ error: '请填写邮箱和密码' });
      const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
      if (!rows.length || hashPw(password, rows[0].salt).hash !== rows[0].hash) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      const u = rows[0];
      return res.json({ message: '登录成功', token: sign(u), user: { id: u.id, name: u.name, email: u.email } });
    }

    // POST /orders
    if (path === '/orders' && req.method === 'POST') {
      const user = auth();
      if (!user) return res.status(401).json({ error: '未登录' });
      const { name, phone, address, note, quantity } = body;
      if (!name || !phone || !address) return res.status(400).json({ error: '请填写完整的收货信息' });
      const qty = Math.max(1, Math.min(99, parseInt(quantity) || 1));
      const oid = genId('ZCX');
      await pool.query(
        'INSERT INTO orders(id,user_id,quantity,total_price,receiver_name,receiver_phone,receiver_address,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [oid, user.id, qty, qty * 1999, name, phone, address, note || '']
      );
      return res.status(201).json({ message: '订单创建成功', order: { id: oid, total: qty * 1999, status: 'pending' } });
    }

    // GET /orders
    if (path === '/orders' && req.method === 'GET') {
      const user = auth();
      if (!user) return res.status(401).json({ error: '未登录' });
      const { rows } = await pool.query('SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC', [user.id]);
      return res.json({ orders: rows });
    }

    // POST /payment/alipay
    if (path === '/payment/alipay' && req.method === 'POST') {
      const user = auth(); if (!user) return res.status(401).json({ error: '未登录' });
      const { orderId } = body;
      const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, user.id]);
      if (!rows.length) return res.status(404).json({ error: '订单不存在' });
      if (rows[0].status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
      await pool.query('UPDATE orders SET payment_method=$1, payment_trade_no=$2, payment_status=$3 WHERE id=$4', ['alipay', genId('ALI'), 'pending', orderId]);
      return res.json({ message: '支付单已创建', payment: { amount: rows[0].total_price } });
    }

    // POST /payment/wechat
    if (path === '/payment/wechat' && req.method === 'POST') {
      const user = auth(); if (!user) return res.status(401).json({ error: '未登录' });
      const { orderId } = body;
      const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, user.id]);
      if (!rows.length) return res.status(404).json({ error: '订单不存在' });
      if (rows[0].status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
      await pool.query('UPDATE orders SET payment_method=$1, payment_trade_no=$2, payment_status=$3 WHERE id=$4', ['wechat', genId('WX'), 'pending', orderId]);
      return res.json({ message: '支付单已创建', payment: { amount: rows[0].total_price } });
    }

    // POST /payment/confirm
    if (path === '/payment/confirm' && req.method === 'POST') {
      const user = auth(); if (!user) return res.status(401).json({ error: '未登录' });
      const { orderId } = body;
      const { rows } = await pool.query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [orderId, user.id]);
      if (!rows.length) return res.status(404).json({ error: '订单不存在' });
      if (rows[0].status !== 'pending') return res.status(400).json({ error: '订单状态异常' });
      await pool.query("UPDATE orders SET status='paid', payment_status='paid', paid_at=NOW() WHERE id=$1", [orderId]);
      sendOrderEmail(rows[0], user.email);
      return res.json({ message: '支付确认成功', order: { id: orderId, status: 'paid' } });
    }

    // GET /me
    if (path === '/me' && req.method === 'GET') {
      const user = auth(); if (!user) return res.status(401).json({ error: '未登录' });
      const { rows } = await pool.query('SELECT id,name,email,phone FROM users WHERE id=$1', [user.id]);
      return res.json({ user: rows[0] || null });
    }

    // GET /health
    if (path === '/health' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT NOW() as t');
      return res.json({ status: 'ok', db: rows[0]?.t, uptime: process.uptime() });
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: e.message || '服务器错误' });
  }
};

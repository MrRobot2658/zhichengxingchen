const { Pool } = require('pg');
const { createHash, randomBytes } = require('crypto');
const nodemailer = require('nodemailer');

// ── 数据库连接 ──
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ── Gmail 邮件 ──
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });
  return transporter;
}

async function sendOrderConfirmation(order, userEmail) {
  const mailer = getTransporter();
  if (!mailer) return console.warn('⚠️ Gmail 未配置，跳过邮件发送');
  try {
    await mailer.sendMail({
      from: `"知诚星辰智能" <${process.env.GMAIL_USER}>`,
      to: userEmail,
      subject: `🎉 订单确认 — ${order.id}`,
      html: `
        <div style="max-width:600px;margin:0 auto;font-family:'Noto Sans SC',sans-serif;background:#101018;color:#e8e8f0;padding:32px;border-radius:16px;border:1px solid #2a2a45;">
          <div style="text-align:center;margin-bottom:24px;">
            <span style="font-size:36px;">✦</span>
            <h1 style="color:#a29bfe;margin:8px 0;">知诚星辰智能</h1>
            <p style="color:#9898b8;">让机器人拥有温度</p>
          </div>
          <div style="background:#181825;border-radius:12px;padding:24px;margin-bottom:20px;">
            <h2 style="margin:0 0 16px;font-size:20px;">✅ 支付成功！</h2>
            <table style="width:100%;font-size:14px;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#9898b8;">订单号</td><td style="padding:8px 0;color:#a29bfe;font-weight:700;"><code>${order.id}</code></td></tr>
              <tr><td style="padding:8px 0;color:#9898b8;">商品</td><td style="padding:8px 0;">${order.product} × ${order.quantity}</td></tr>
              <tr><td style="padding:8px 0;color:#9898b8;">金额</td><td style="padding:8px 0;font-weight:700;">¥${order.total_price.toLocaleString()}</td></tr>
              <tr><td style="padding:8px 0;color:#9898b8;">收货人</td><td style="padding:8px 0;">${order.receiver_name}</td></tr>
              <tr><td style="padding:8px 0;color:#9898b8;">收货地址</td><td style="padding:8px 0;">${order.receiver_address}</td></tr>
              <tr><td style="padding:8px 0;color:#9898b8;">支付方式</td><td style="padding:8px 0;">${order.payment_method === 'alipay' ? '💙 支付宝' : '💚 微信支付'}</td></tr>
            </table>
          </div>
          <p style="color:#9898b8;font-size:13px;text-align:center;">
            🚚 预计 7-15 个工作日内发货<br>
            如有问题请联系：${process.env.GMAIL_USER || 'hello@zhichengxingchen.com'}
          </p>
          <hr style="border:none;border-top:1px solid #2a2a45;margin:20px 0;">
          <p style="color:#606080;font-size:12px;text-align:center;">
            知诚星辰智能（青岛）有限公司
          </p>
        </div>
      `,
    });
    console.log(`📧 确认邮件已发送至 ${userEmail}`);
  } catch (e) {
    console.error('❌ 邮件发送失败:', e.message);
  }
}

// ── JWT ──
let jwt;
try { jwt = require('jsonwebtoken'); } catch {}
const JWT_SECRET = process.env.JWT_SECRET || 'zcx-' + Date.now();

function signToken(user) {
  if (jwt) return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
  return 'zcx_' + Buffer.from(JSON.stringify({ id: user.id, email: user.email, name: user.name, exp: Date.now() + 7*86400000 })).toString('base64');
}

function verifyToken(token) {
  if (jwt) return jwt.verify(token, JWT_SECRET);
  if (!token.startsWith('zcx_')) throw new Error('invalid');
  const payload = JSON.parse(Buffer.from(token.slice(4), 'base64').toString());
  if (payload.exp < Date.now()) throw new Error('expired');
  return payload;
}

// ── 工具 ──
function hashPw(pw, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: createHash('sha256').update(salt + pw).digest('hex') };
}
function verifyPw(pw, salt, hash) { return hashPw(pw, salt).hash === hash; }
function genId(p = '') { return p + Date.now().toString(36).toUpperCase() + randomBytes(3).toString('hex').toUpperCase(); }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function auth(req) {
  const h = req.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  try {
    const decoded = verifyToken(h.slice(7));
    const { rows } = await pool.query('SELECT id, name, email, phone FROM users WHERE id = $1', [decoded.id]);
    return rows[0] || null;
  } catch { return null; }
}

// ── 自动建表 ──
async function ensureTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
        product TEXT NOT NULL DEFAULT '知诚星辰 · 陪伴版',
        quantity INTEGER NOT NULL DEFAULT 1, unit_price INTEGER NOT NULL DEFAULT 1999,
        total_price INTEGER NOT NULL,
        receiver_name TEXT NOT NULL, receiver_phone TEXT NOT NULL, receiver_address TEXT NOT NULL,
        note TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        payment_method TEXT, payment_trade_no TEXT, payment_status TEXT,
        created_at TIMESTAMP DEFAULT NOW(), paid_at TIMESTAMP,
        shipped_at TIMESTAMP, delivered_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    `);
    console.log('✅ 数据库表已就绪');
  } catch (e) {
    console.error('❌ 建表失败:', e.message);
  }
}

// ── HTTP 路由 ──
async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const pathname = url.pathname.replace(/^\/api/, '') || '/';

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    // ── POST /auth/register ──
    if (pathname === '/auth/register' && method === 'POST') {
      const { name, email, phone, password } = await req.json();
      if (!name || !email || !phone || !password) return json({ error: '请填写所有必填字段' }, 400);

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) return json({ error: '该邮箱已被注册' }, 409);

      const { salt, hash } = hashPw(password);
      const id = genId('U');
      await pool.query(
        'INSERT INTO users (id, name, email, phone, salt, hash) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, name, email, phone, salt, hash]
      );

      const token = signToken({ id, name, email });
      return json({ message: '注册成功', token, user: { id, name, email } }, 201);
    }

    // ── POST /auth/login ──
    if (pathname === '/auth/login' && method === 'POST') {
      const { email, password } = await req.json();
      if (!email || !password) return json({ error: '请填写邮箱和密码' }, 400);

      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (rows.length === 0 || !verifyPw(password, rows[0].salt, rows[0].hash)) {
        return json({ error: '邮箱或密码错误' }, 401);
      }

      const user = rows[0];
      const token = signToken(user);
      return json({ message: '登录成功', token, user: { id: user.id, name: user.name, email: user.email } });
    }

    // ── POST /orders ──
    if (pathname === '/orders' && method === 'POST') {
      const user = await auth(req);
      if (!user) return json({ error: '未登录' }, 401);

      const { name, phone, address, note, quantity } = await req.json();
      if (!name || !phone || !address) return json({ error: '请填写完整的收货信息' }, 400);

      const qty = Math.max(1, Math.min(99, parseInt(quantity) || 1));
      const order = {
        id: genId('ZCX'), user_id: user.id, product: '知诚星辰 · 陪伴版',
        quantity: qty, unit_price: 1999, total_price: qty * 1999,
        receiver_name: name, receiver_phone: phone, receiver_address: address,
        note: note || '',
      };

      await pool.query(
        `INSERT INTO orders (id, user_id, product, quantity, unit_price, total_price,
         receiver_name, receiver_phone, receiver_address, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [order.id, order.user_id, order.product, order.quantity,
         order.unit_price, order.total_price,
         order.receiver_name, order.receiver_phone, order.receiver_address, order.note]
      );

      return json({ message: '订单创建成功', order: { id: order.id, total: order.total_price, status: 'pending' } }, 201);
    }

    // ── GET /orders ──
    if (pathname === '/orders' && method === 'GET') {
      const user = await auth(req);
      if (!user) return json({ error: '未登录' }, 401);

      const { rows } = await pool.query(
        'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [user.id]
      );
      return json({ orders: rows });
    }

    // ── POST /payment/alipay ──
    if (pathname === '/payment/alipay' && method === 'POST') {
      const user = await auth(req);
      if (!user) return json({ error: '未登录' }, 401);

      const { orderId } = await req.json();
      const { rows } = await pool.query(
        'SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, user.id]
      );
      if (rows.length === 0) return json({ error: '订单不存在' }, 404);
      if (rows[0].status !== 'pending') return json({ error: '订单状态异常' }, 400);

      await pool.query(
        `UPDATE orders SET payment_method = 'alipay', payment_trade_no = $1, payment_status = 'pending' WHERE id = $2`,
        [genId('ALI'), orderId]
      );

      return json({ message: '支付宝支付单已创建', payment: { tradeNo: genId('ALI'), amount: rows[0].total_price } });
    }

    // ── POST /payment/wechat ──
    if (pathname === '/payment/wechat' && method === 'POST') {
      const user = await auth(req);
      if (!user) return json({ error: '未登录' }, 401);

      const { orderId } = await req.json();
      const { rows } = await pool.query(
        'SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, user.id]
      );
      if (rows.length === 0) return json({ error: '订单不存在' }, 404);
      if (rows[0].status !== 'pending') return json({ error: '订单状态异常' }, 400);

      await pool.query(
        `UPDATE orders SET payment_method = 'wechat', payment_trade_no = $1, payment_status = 'pending' WHERE id = $2`,
        [genId('WX'), orderId]
      );

      return json({ message: '微信支付单已创建', payment: { tradeNo: genId('WX'), amount: rows[0].total_price } });
    }

    // ── POST /payment/confirm ──
    if (pathname === '/payment/confirm' && method === 'POST') {
      const user = await auth(req);
      if (!user) return json({ error: '未登录' }, 401);

      const { orderId } = await req.json();
      const { rows } = await pool.query(
        'SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, user.id]
      );
      if (rows.length === 0) return json({ error: '订单不存在' }, 404);
      if (rows[0].status !== 'pending') return json({ error: '订单状态异常' }, 400);

      await pool.query(
        `UPDATE orders SET status = 'paid', payment_status = 'paid', paid_at = NOW() WHERE id = $1`,
        [orderId]
      );

      // 发送确认邮件（不阻塞响应）
      sendOrderConfirmation(rows[0], user.email);

      return json({ message: '支付确认成功', order: { id: orderId, status: 'paid' } });
    }

    // ── GET /me ──
    if (pathname === '/me' && method === 'GET') {
      const user = await auth(req);
      if (!user) return json({ error: '未登录' }, 401);
      return json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
    }

    // ── GET /health ──
    if (pathname === '/health') {
      const { rows } = await pool.query('SELECT NOW() as time');
      return json({ status: 'ok', db: rows[0].time, uptime: process.uptime() });
    }

    return json({ error: 'Not found' }, 404);

  } catch (e) {
    console.error('Error:', e);
    return json({ error: e.message || '服务器错误' }, 500);
  }
}

// ── 启动时建表 ──
ensureTables();

// ── Vercel Export ──
module.exports = handler;

// ── 本地开发 ──
if (require.main === module) {
  const http = require('http');
  const server = http.createServer(async (req, res) => {
    const body = await new Promise(r => { let d = []; req.on('data', c => d.push(c)); req.on('end', () => r(Buffer.concat(d).toString())); });
    const webReq = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: method !== 'GET' && method !== 'OPTIONS' ? body : undefined,
    });
    const webRes = await handler(webReq);
    res.writeHead(webRes.status, Object.fromEntries(webRes.headers));
    res.end(await webRes.text());
  });
  server.listen(3001, () => console.log('API: http://localhost:3001'));
}

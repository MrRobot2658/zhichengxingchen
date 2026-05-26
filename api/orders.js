const { readTable, writeTable, genId } = require('./_lib/db');
const { authMiddleware, corsHeaders } = require('./_lib/auth');

const UNIT_PRICE = 1999; // ¥1,999

module.exports = async (req) => {
  const headers = { 'Content-Type': 'application/json', ...corsHeaders() };
  if (req.method === 'OPTIONS') return new Response(null, { headers, status: 204 });

  // 验证登录
  const auth = authMiddleware(req);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), { headers, status: auth.status });
  }

  if (req.method === 'POST') {
    try {
      const { name, phone, address, note, quantity } = await req.json();
      if (!name || !phone || !address) {
        return new Response(JSON.stringify({ error: '请填写完整的收货信息' }), { headers, status: 400 });
      }

      const qty = Math.max(1, Math.min(99, parseInt(quantity) || 1));
      const total = qty * UNIT_PRICE;

      const order = {
        id: genId('ZCX'),
        userId: auth.user.id,
        userName: auth.user.name,
        userEmail: auth.user.email,
        product: '知诚星辰 · 陪伴版',
        quantity: qty,
        unitPrice: UNIT_PRICE,
        totalPrice: total,
        receiver: { name, phone, address },
        note: note || '',
        status: 'pending',      // pending → paid → shipped → delivered
        payment: null,
        createdAt: new Date().toISOString(),
      };

      const orders = readTable('orders');
      orders.push(order);
      writeTable('orders', orders);

      return new Response(JSON.stringify({
        message: '订单创建成功',
        order: {
          id: order.id,
          total: order.totalPrice,
          status: order.status,
        },
      }), { headers, status: 201 });

    } catch (e) {
      return new Response(JSON.stringify({ error: '服务器错误' }), { headers, status: 500 });
    }
  }

  if (req.method === 'GET') {
    // 获取我的订单
    const orders = readTable('orders');
    const myOrders = orders
      .filter(o => o.userId === auth.user.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return new Response(JSON.stringify({ orders: myOrders }), { headers, status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { headers, status: 405 });
};

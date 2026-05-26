// 健康检查 - 极简函数
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  
  try {
    const { createHash } = require('crypto');
    return res.json({
      ok: true,
      time: new Date().toISOString(),
      env: {
        pg: !!process.env.POSTGRES_URL,
        gmail: !!process.env.GMAIL_USER,
        node: process.version,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

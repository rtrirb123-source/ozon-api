const https = require('https');
const axios = require('axios');

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const SPREADSHEET_TOKEN = process.env.SPREADSHEET_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '14a7cb';
const PORT = process.env.PORT || 3000;

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getFeishuToken() {
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET },
    { headers: { 'Content-Type': 'application/json' } }
  );
  return res.data.tenant_access_token;
}

async function getProducts(token) {
  // 读取 Feishu 全量产品 A~K 列（含竞品对比）
  const res = await axios.get(
    `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A1:K200`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const rows = res.data?.data?.valueRange?.values || [];
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r[0]).map(row => {
    const p = {};
    header.forEach((h, i) => { if (row[i] !== undefined) p[h] = row[i]; });
    return p;
  });
}

async function handleRequest(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    const token = await getFeishuToken();

    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', source: 'feishu-direct' }));
      return;
    }

    if (path === '/products' && req.method === 'GET') {
      const products = await getProducts(token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ products }));
      return;
    }

    if (path === '/products' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      await new Promise(r => req.on('end', r));
      const d = JSON.parse(body || '{}');
      
      const sheetRes = await axios.get(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A:A`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const rows = sheetRes.data?.data?.valueRange?.values || [];
      let targetRow = rows.length + 1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0] || '').trim() === String(d.offer_id || '').trim()) {
          targetRow = i + 1; break;
        }
      }

      await axios.put(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values`,
        {
          valueRange: {
            range: `${SHEET_ID}!A${targetRow}:K${targetRow}`,
            values: [[
              d.offer_id || '', d.product_id ? String(d.product_id) : '',
              d['产品策略'] || d.strategy || '',
              d['佣金率'] ?? d.commission ?? '',
              d['采购成本'] ?? d.procurement_cost ?? '',
              d['重量'] ?? d.weight ?? '',
              d['运费系数'] ?? d.freight_rate ?? '',
              d['退货率'] ?? d.return_rate ?? '',
              d['广告比例'] ?? d.ad_ratio ?? '',
              d['售价'] ?? d.price ?? '',
              d['竞品对比'] || '',
            ]]
          }
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error(err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = https.createServer((req, res) => handleRequest(req, res));
server.listen(PORT, () => console.log(`Listening on ${PORT}`));


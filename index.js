const https = require('https');
const axios = require('axios');

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const SPREADSHEET_TOKEN = process.env.SPREADSHEET_TOKEN;
const SHEET_ID = process.env.SHEET_ID || '14a7cb';
const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGIN = [
  'https://ccnr2ygm3o2b.aiforce.cloud',
  'https://miaoda.feishu.cn',
];

async function getFeishuToken() {
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }
  );
  return res.data.tenant_access_token;
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGIN.find(o => origin?.startsWith(o)) || ALLOWED_ORIGIN[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

const server = require('http').createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const { method, url } = req;
  const pathname = new URL(url, 'http://localhost').pathname;

  try {
    const token = await getFeishuToken();
    const headers = { 'Authorization': `Bearer ${token}` };

    if (pathname === '/health' && method === 'GET') {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (pathname === '/products' && method === 'GET') {
      const range = `${SHEET_ID}!A1:J200`;
      const response = await axios.get(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${range}`,
        { headers }
      );
      const rows = response.data?.data?.valueRange?.values || [];
      if (rows.length < 2) {
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ products: [] }));
        return;
      }
      const [headerRow, ...items] = rows;
      const products = items.map(row => {
        const p = {};
        headerRow.forEach((h, i) => { p[h] = row[i] ?? ''; });
        return p;
      }).filter(p => p.offer_id);
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ products }));
      return;
    }

    if (pathname === '/products' && method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      await new Promise(resolve => req.on('end', resolve));
      const data = JSON.parse(body);
      const { offer_id, product_id, strategy, commission, procurement_cost,
              weight, freight_rate, return_rate, ad_ratio, price } = data;

      const readRes = await axios.get(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A:A`,
        { headers }
      );
      const rows = readRes.data?.data?.valueRange?.values || [];
      let targetRow = rows.length + 1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(offer_id)) { targetRow = i + 1; break; }
      }

      const rowData = [[
        offer_id || '',
        product_id ? String(product_id) : '',
        strategy || '',
        commission ?? '',
        procurement_cost ?? '',
        weight ?? '',
        freight_rate ?? '',
        return_rate ?? '',
        ad_ratio ?? '',
        price ?? '',
      ]];

      await axios.put(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${SPREADSHEET_TOKEN}/values/${SHEET_ID}!A${targetRow}:J${targetRow}`,
        { values: rowData },
        { headers }
      );

      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, row: targetRow }));
      return;
    }

    res.writeHead(404, { ...cors });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Ozon API running on port ${PORT}`);
});

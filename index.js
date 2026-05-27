const http = require("http");
const https = require("https");

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const startedAt = new Date().toISOString();
const PORT = process.env.PORT || 3000;

const COLS = {
  strategy: "\u4ea7\u54c1\u7b56\u7565",
  commissionRate: "\u4f63\u91d1\u7387",
  purchaseCost: "\u91c7\u8d2d\u6210\u672c",
  weight: "\u91cd\u91cf",
  freightRate: "\u8fd0\u8d39\u7cfb\u6570",
  returnRate: "\u9000\u8d27\u7387",
  adRatio: "\u5e7f\u544a\u6bd4\u4f8b",
  price: "\u552e\u4ef7",
  competitorCompare: "\u7ade\u54c1\u5bf9\u6bd4",
  image: "\u5546\u54c1\u56fe\u7247"
};

const config = {
  appId: process.env.FEISHU_APP_ID || "",
  appSecret: process.env.FEISHU_APP_SECRET || "",
  spreadsheetToken: process.env.SPREADSHEET_TOKEN || process.env.FEISHU_TABLE_TOKEN || "",
  sheetId: process.env.SHEET_ID || process.env.FEISHU_SHEET_ID || "14a7cb",
  range: process.env.FEISHU_RANGE || "A:L",
  cacheTtlMs: Number(process.env.CACHE_TTL_SECONDS || 60) * 1000
};

const cache = {
  value: null,
  expiresAt: 0,
  updatedAt: null
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res, statusCode, body) {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function missingConfig() {
  return Object.entries({
    FEISHU_APP_ID: config.appId,
    FEISHU_APP_SECRET: config.appSecret,
    SPREADSHEET_TOKEN: config.spreadsheetToken,
    SHEET_ID: config.sheetId
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body || "";
    const req = https.request(
      {
        method: options.method || "GET",
        hostname: parsed.hostname,
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          ...(options.headers || {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {})
        },
        timeout: options.timeoutMs || 20000
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ statusCode: res.statusCode || 0, body: data ? JSON.parse(data) : {} });
          } catch (error) {
            error.statusCode = 502;
            error.details = data.slice(0, 500);
            reject(error);
          }
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("Feishu request timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function feishuRequest(url, options = {}) {
  const response = await requestJson(url, options);
  if (response.statusCode < 200 || response.statusCode >= 300 || response.body.code !== 0) {
    const error = new Error(response.body.msg || `Feishu request failed with HTTP ${response.statusCode}`);
    error.statusCode = 502;
    error.details = response.body;
    throw error;
  }
  return response.body;
}

async function getFeishuToken() {
  const missing = missingConfig();
  if (missing.length) {
    const error = new Error(`Missing environment variables: ${missing.join(", ")}`);
    error.statusCode = 500;
    throw error;
  }

  const body = await feishuRequest(`${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    }),
    timeoutMs: 15000
  });

  if (!body.tenant_access_token) {
    const error = new Error("Feishu tenant token missing in response");
    error.statusCode = 502;
    error.details = body;
    throw error;
  }
  return body.tenant_access_token;
}

function normalizeHeader(value, index) {
  const text = String(value || "").trim();
  return text || `column_${index + 1}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value).replace(/[,，%]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function pick(row, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== "") {
      return row[key];
    }
  }
  return "";
}

function rowsToObjects(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const headers = values[0].map(normalizeHeader);
  return values
    .slice(1)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = row[index] ?? "";
      });
      return item;
    });
}

function normalizeProduct(row, index) {
  const sku = pick(row, ["SKU", "sku", "offer_id", "\u5546\u54c1SKU", "\u8d27\u53f7", "\u7f16\u7801"]);
  const title = pick(row, ["\u6807\u9898", "\u5546\u54c1\u6807\u9898", "\u5546\u54c1\u540d\u79f0", "\u54c1\u540d", "Title", "title"]);
  return {
    id: sku || `row-${index + 1}`,
    sku,
    offer_id: sku,
    title,
    sales: toNumber(pick(row, ["\u9500\u91cf", "\u9500\u552e\u91cf", "\u8ba2\u5355\u6570", "Sales", "sales"])),
    revenue: toNumber(pick(row, ["\u9500\u552e\u989d", "\u6536\u5165", "GMV", "revenue"])),
    stock: toNumber(pick(row, ["\u5e93\u5b58", "\u53ef\u552e\u5e93\u5b58", "Stock", "stock"])),
    profit: toNumber(pick(row, ["\u5229\u6da6", "\u51c0\u5229\u6da6", "profit"])),
    profitRate: toNumber(pick(row, ["\u5229\u6da6\u7387", "\u51c0\u5229\u6da6\u7387", "profitRate"])),
    purchasePrice: toNumber(pick(row, ["\u91c7\u8d2d\u4ef7", "\u91c7\u8d2d\u4ef7\u683c_CNY", "purchasePrice"])),
    status: pick(row, ["\u72b6\u6001", "\u662f\u5426\u5408\u683c", "status"]),
    imageUrl: pick(row, [COLS.image, "\u56fe\u7247", "\u4e3b\u56fe", "image", "imageUrl", "mainImage", "product_image", "productImage"]),
    raw: row
  };
}

async function getSheetValues(range = config.range) {
  const token = await getFeishuToken();
  const encodedRange = encodeURIComponent(`${config.sheetId}!${range}`);
  const body = await feishuRequest(
    `${FEISHU_BASE_URL}/sheets/v2/spreadsheets/${config.spreadsheetToken}/values/${encodedRange}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return body.data?.valueRange?.values || [];
}

async function updateSheetRow(rowNumber, values) {
  const token = await getFeishuToken();
  return feishuRequest(`${FEISHU_BASE_URL}/sheets/v2/spreadsheets/${config.spreadsheetToken}/values`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      valueRange: {
        range: `${config.sheetId}!A${rowNumber}:L${rowNumber}`,
        values: [values]
      }
    })
  });
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function valueFromPayload(payload, keys, fallback) {
  for (const key of keys) {
    if (hasOwn(payload, key)) return payload[key] ?? "";
  }
  return fallback ?? "";
}

function rowToObject(row) {
  return {
    offer_id: row[0] ?? "",
    product_id: row[1] ?? "",
    [COLS.strategy]: row[2] ?? "",
    [COLS.commissionRate]: row[3] ?? "",
    [COLS.purchaseCost]: row[4] ?? "",
    [COLS.weight]: row[5] ?? "",
    [COLS.freightRate]: row[6] ?? "",
    [COLS.returnRate]: row[7] ?? "",
    [COLS.adRatio]: row[8] ?? "",
    [COLS.price]: row[9] ?? "",
    [COLS.competitorCompare]: row[10] ?? "",
    [COLS.image]: row[11] ?? ""
  };
}

async function fetchDashboard({ refresh = false } = {}) {
  if (!refresh && cache.value && Date.now() < cache.expiresAt) {
    return { ...cache.value, cache: { hit: true, updatedAt: cache.updatedAt } };
  }

  const values = await getSheetValues(config.range);
  const rows = rowsToObjects(values);
  const products = rows.map(normalizeProduct);
  const summary = products.reduce(
    (acc, product) => {
      acc.productCount += 1;
      acc.totalSales += product.sales || 0;
      acc.totalRevenue += product.revenue || 0;
      acc.totalProfit += product.profit || 0;
      if ((product.stock ?? 999999) <= 5) acc.lowStockCount += 1;
      if ((product.profit ?? 0) < 0) acc.negativeProfitCount += 1;
      if (!product.purchasePrice) acc.missingPurchasePriceCount += 1;
      return acc;
    },
    {
      productCount: 0,
      totalSales: 0,
      totalRevenue: 0,
      totalProfit: 0,
      lowStockCount: 0,
      negativeProfitCount: 0,
      missingPurchasePriceCount: 0
    }
  );

  const data = {
    summary,
    products,
    rows,
    source: {
      provider: "feishu",
      sheetId: config.sheetId,
      range: config.range
    },
    fetchedAt: new Date().toISOString()
  };

  cache.value = data;
  cache.expiresAt = Date.now() + config.cacheTtlMs;
  cache.updatedAt = new Date().toISOString();
  return { ...data, cache: { hit: false, updatedAt: cache.updatedAt } };
}

async function saveProduct(payload) {
  const values = await getSheetValues("A:L");
  let targetRow = values.length + 1;
  const targetOfferId = String(payload.offer_id || payload.sku || payload.SKU || "").trim();
  let existingRow = [];

  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][0] || "").trim() === targetOfferId) {
      targetRow = index + 1;
      existingRow = values[index] || [];
      break;
    }
  }

  const nextRow = [
    valueFromPayload(payload, ["offer_id", "sku", "SKU"], existingRow[0]),
    valueFromPayload(payload, ["product_id"], existingRow[1]),
    valueFromPayload(payload, [COLS.strategy, "strategy", "product_strategy"], existingRow[2]),
    valueFromPayload(payload, [COLS.commissionRate, "\u4f63\u91d1", "commission", "commission_rate", "commissionRate"], existingRow[3]),
    valueFromPayload(payload, [COLS.purchaseCost, "\u91c7\u8d2d\u4ef7", "\u91c7\u8d2d\u4ef7\u683c", "procurement_cost", "purchase_cost", "purchasePrice"], existingRow[4]),
    valueFromPayload(payload, [COLS.weight, "weight"], existingRow[5]),
    valueFromPayload(payload, [COLS.freightRate, "freight_rate", "freightRate"], existingRow[6]),
    valueFromPayload(payload, [COLS.returnRate, "return_rate", "returnRate"], existingRow[7]),
    valueFromPayload(payload, [COLS.adRatio, "ad_ratio", "adRatio"], existingRow[8]),
    valueFromPayload(payload, [COLS.price, "\u4ef7\u683c", "\u552e\u5356\u4ef7", "\u9500\u552e\u4ef7", "price", "sale_price", "salePrice", "selling_price", "sellingPrice"], existingRow[9]),
    valueFromPayload(payload, [COLS.competitorCompare, "\u7ade\u54c1\u4fe1\u606f", "competitor_compare", "competitorCompare"], existingRow[10]),
    valueFromPayload(payload, [COLS.image, "\u56fe\u7247", "\u4e3b\u56fe", "image", "imageUrl", "mainImage", "product_image", "productImage"], existingRow[11])
  ];

  await updateSheetRow(targetRow, nextRow);
  cache.value = null;
  return { success: true, row: targetRow, partialUpdate: true, product: rowToObject(nextRow) };
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function handleRequest(req, res) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = decodeURIComponent(url.pathname);

  if (req.method === "GET" && path === "/") {
    sendJson(res, 200, {
      ok: true,
      service: "ozon-api",
      endpoints: ["/health", "/products", "/api/dashboard", "/api/products", "/api/summary", "/api/refresh"]
    });
    return;
  }

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, {
      ok: true,
      status: "ok",
      service: "ozon-api",
      startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      feishu: {
        configured: missingConfig().length === 0,
        missing: missingConfig()
      },
      cache: {
        updatedAt: cache.updatedAt,
        ttlSeconds: Math.round(config.cacheTtlMs / 1000)
      }
    });
    return;
  }

  if (req.method === "GET" && (path === "/products" || path === "/api/products")) {
    const dashboard = await fetchDashboard();
    sendJson(res, 200, path === "/products" ? { products: dashboard.rows } : {
      ok: true,
      data: dashboard.products,
      meta: { count: dashboard.products.length, cache: dashboard.cache }
    });
    return;
  }

  if (req.method === "POST" && path === "/products") {
    const payload = await readJsonBody(req);
    sendJson(res, 200, await saveProduct(payload));
    return;
  }

  if (req.method === "GET" && path === "/api/dashboard") {
    sendJson(res, 200, { ok: true, data: await fetchDashboard() });
    return;
  }

  if (req.method === "GET" && path === "/api/summary") {
    const dashboard = await fetchDashboard();
    sendJson(res, 200, {
      ok: true,
      data: dashboard.summary,
      meta: { cache: dashboard.cache, fetchedAt: dashboard.fetchedAt }
    });
    return;
  }

  if (req.method === "POST" && path === "/api/refresh") {
    cache.value = null;
    sendJson(res, 200, { ok: true, data: await fetchDashboard({ refresh: true }) });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("[api:error]", {
      method: req.method,
      url: req.url,
      message: error.message,
      details: error.details
    });
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on 0.0.0.0:${PORT}`);
});

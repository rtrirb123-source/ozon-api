# Ozon API

Railway-ready API for the Ozon dashboard.

## What changed

- Uses `http.createServer`, not `https.createServer`. Railway handles HTTPS before traffic reaches the container.
- Uses only Node.js built-ins, so there are no dependency-install failures.
- Feishu requests use Node's `https` module, so the service does not depend on runtime `fetch` support.
- `/health` does not call Feishu, so the service can start and pass health checks even when Feishu is temporarily unavailable.
- Keeps the old frontend endpoints:
  - `GET /products`
  - `POST /products`
- `POST /products` now performs a partial row update: fields omitted by the
  frontend keep their existing Feishu values instead of being cleared.
- `POST /products` accepts common aliases such as `佣金`, `commission`,
  `佣金率`, `售价`, `价格`, `price`, and returns the merged saved row as
  `product`.
- Adds stable dashboard endpoints:
  - `GET /api/dashboard`
  - `GET /api/products`
  - `GET /api/summary`
  - `POST /api/refresh`

## Railway variables

Set these in Railway:

```text
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
SPREADSHEET_TOKEN=...
SHEET_ID=14a7cb
FEISHU_RANGE=A:K
CACHE_TTL_SECONDS=60
```

`FEISHU_TABLE_TOKEN` and `FEISHU_SHEET_ID` are also supported as aliases.

For product images, add column L in Feishu with the header:

```text
商品图片
```

Then set Railway `FEISHU_RANGE=A:L` or remove the variable so the API uses the
default `A:L` range. `POST /products` accepts image fields named `商品图片`,
`图片`, `主图`, `image`, `imageUrl`, `mainImage`, `product_image`, or
`productImage`.

## Verify after deploy

Open:

```text
/health
/
/products
/api/dashboard
```

`/health` should return `ok: true` immediately after deployment.

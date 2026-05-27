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

## Verify after deploy

Open:

```text
/health
/
/products
/api/dashboard
```

`/health` should return `ok: true` immediately after deployment.

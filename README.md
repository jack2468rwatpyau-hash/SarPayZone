# Sar Pay Zone (စာပေဇုန်)

Sar Pay Zone is a Myanmar literature marketplace with a static HTML/CSS/JavaScript frontend and an Express API backed by Turso LibSQL.

## Repository layout

| Path | Purpose |
|---|---|
| `server.js` | Express, Socket.IO, middleware, API mounting, health endpoint |
| `routes/` | Authentication, products, orders, wallet, chat, shipping, voting, resell, and admin APIs |
| `database/schema.sql` | Turso/SQLite schema and seed configuration |
| `frontend/` | Buyer storefront, seller dashboards, admin panel, and login pages |
| `middleware/` | Authentication, role checks, uploads, and errors |
| `utils/` | Cloudinary, Telegram, push, commission, Gemini, and cron integrations |

## Backend setup

```bash
cp .env.example .env
npm install
npm start
```

The API listens on `PORT` and exposes `GET /health` for deployment checks. Configure all values in `.env`; never commit real credentials. In production, `JWT_SECRET` is required and the application refuses to use a development fallback.

## Frontend preview

```bash
cd frontend
python3 -m http.server 4173 --bind 0.0.0.0
```

The frontend currently uses the deployed API URL in each static page. If the backend is deployed elsewhere, update that API base configuration before publishing the frontend.

## Database

Apply the complete `database/schema.sql` to a new configured Turso database before starting the service. For an existing database created from an earlier revision, take a backup first and apply the schema changes through the Turso SQL console in a controlled migration; apply `database/migrations/003_agent_deposit_verification.sql` for the verified Agent cash-in table. Do not overwrite production data blindly. The complete schema includes product images, admin/agent seller roles and seeds, seller order retention, C2C markup fields, C2C order references, district-level shipping, and agent deposit audit records. Change the seeded admin and agent credentials after first deployment. Socket.io clients must send their JWT in `auth.token`; connections and conversation membership are verified server-side. The application uses a small database adapter in `db.js` that normalizes empty query arguments for the current `@libsql/client` behavior.

Payment policy: an Agent only adds verified cash to a Buyer wallet. The Buyer then pays from `My Wallet`; direct `agent` order payment is intentionally disabled. Normal books support Wallet or COD, while C2C resell orders require Wallet payment. Seller-defined shipping is charged once per seller in cart checkout and is paid to that seller on successful settlement. The delivery payout formula is `merchandise total + shipping fee - commission`. Buyer cancellation restores product stock or reopens a resell listing and refunds the wallet payment (minus the documented cancellation fee).

Store owners can use `Store Dashboard → Settings → Store availability` to open or close the storefront, pause new orders, set a buyer-facing reply time, configure a closed-store message, and configure the first-chat auto-reply. Apply `database/migrations/004_store_availability_settings.sql` to an existing Turso database before using this panel. Closed stores remain visible to buyers, but new orders are rejected by the API and purchase buttons are disabled in the product detail view.

## Verification

```bash
for f in server.js config.js db.js routes/*.js middleware/*.js utils/*.js; do node --check "$f"; done
npm ls --depth=0
curl http://localhost:3000/health
```

The public buyer entry point is `frontend/index.html`; seller and admin entry points are the other HTML files in the same directory.

## Security note

The `.env` file is now excluded from the current repository state and `.env.example` contains placeholders only. Earlier Git history contains commits that included `.env`; rotate the Turso, Cloudinary, Telegram, Gemini, VAPID, and JWT credentials before treating the deployment as secure. Removing those historical blobs completely would require an approved history rewrite and force-push.

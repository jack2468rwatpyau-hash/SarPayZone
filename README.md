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

Apply `database/schema.sql` to a new configured Turso database before starting the service. For an existing database created from an earlier revision, apply `database/migrations/001_fix_resell_buyer_owner.sql` before enabling buyer resell listings. The application uses a small database adapter in `db.js` that normalizes empty query arguments for the current `@libsql/client` behavior.

## Verification

```bash
for f in server.js config.js db.js routes/*.js middleware/*.js utils/*.js; do node --check "$f"; done
npm ls --depth=0
curl http://localhost:3000/health
```

The public buyer entry point is `frontend/index.html`; seller and admin entry points are the other HTML files in the same directory.

## Security note

The `.env` file is now excluded from the current repository state and `.env.example` contains placeholders only. Earlier Git history contains commits that included `.env`; rotate the Turso, Cloudinary, Telegram, Gemini, VAPID, and JWT credentials before treating the deployment as secure. Removing those historical blobs completely would require an approved history rewrite and force-push.

# Split Deployment

## Architecture

The public frontend is a Cloudflare Pages SPA at `https://esutmarketplace.com`.
The Express backend runs on the VPS at `https://api.esutmarketplace.com`.
The frontend calls the backend through `VITE_API_URL`; production builds fail
when that variable is missing.

OAuth starts and finishes on the backend. The server sets the host-only
`__Host-oauth_state` cookie, validates it on callback, creates the session, and
redirects back to the frontend. The client never writes that cookie.

## What Deploys Where

- Cloudflare Pages: `client/` frontend assets, including `_redirects` and `_headers`.
- VPS: `server/`, `shared/`, `drizzle/`, and the production Node.js bundle.
- Nginx: `nginx/api.esutmarketplace.com.conf` security headers for the API host.
- Backend environment: `FRONTEND_URL`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, database,
  session, and media service settings.

Any `shared/` change can affect the backend contract. Deploy the backend first,
verify `/healthz`, then publish the matching frontend build.

## Cloudflare Pages Setup

1. Create or select the `esut-marketplace` Pages project.
2. Set the production build command to `pnpm run build:frontend`.
3. Set the output directory to `dist/public`.
4. Set `VITE_API_URL=https://api.esutmarketplace.com` for production.
5. Deploy the repository and confirm deep links resolve through `_redirects`.
6. Confirm the API host serves the headers in `_headers` and the API Nginx config.

## Preview Limitation

Cloudflare preview URLs use the production API URL unless a separate preview
environment is configured. Preview builds can therefore read and write
production data. Treat preview URLs as production clients and do not use them
for unreviewed data-changing tests.
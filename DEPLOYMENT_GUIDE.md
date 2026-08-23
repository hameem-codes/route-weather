# RouteWeather 🚀 Deployment Guide

This guide covers deploying the **RouteWeather** full-stack application:
- **Backend**: Cloudflare Workers (Hono API + D1 Database + Upstash Redis)
- **Frontend**: Vite SPA deployed to Cloudflare Pages (or Vercel / Netlify)

---

## 1. Deploying the Backend (Cloudflare Workers)

### Step 1: Authenticate Wrangler CLI
Run the following command in your terminal to authenticate with your Cloudflare account:
```bash
cd backend
npx wrangler login
```
*A browser window will automatically open asking you to authorize Wrangler.*

### Step 2: Set up Cloudflare D1 Database
Create the production D1 database:
```bash
npx wrangler d1 create route-weather-db
```
Copy the generated `database_id` from the terminal output and paste it into `backend/wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "route-weather-db"
database_id = "YOUR_NEW_DATABASE_ID_HERE"
```

Apply database migrations:
```bash
npx wrangler d1 migrations apply route-weather-db --remote
```

### Step 3: Configure Production Secrets (Optional)
If using Upstash Redis for caching and rate limiting:
```bash
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
npx wrangler secret put JWT_SECRET
```

### Step 4: Deploy the Worker API
```bash
npx wrangler deploy
```
Copy the resulting API URL (e.g. `https://routeweather-api.<your-username>.workers.dev`).

---

## 2. Deploying the Frontend

### Option A: Deploy to Cloudflare Pages (Recommended)

1. Build the production assets:
   ```bash
   # In the root project directory
   npm run build
   ```

2. Deploy the `dist/` folder using Wrangler:
   ```bash
   npx wrangler pages deploy dist --project-name=routeweather
   ```
   Select `Create a new project` if prompted.

3. Update Frontend Environment Variable:
   Add `VITE_API_URL` to your Cloudflare Pages dashboard under **Settings > Environment variables**:
   ```env
   VITE_API_URL=https://routeweather-api.<your-username>.workers.dev
   ```

---

### Option B: Deploy to Vercel

1. Install Vercel CLI & deploy:
   ```bash
   npx vercel
   ```
2. Add `VITE_API_URL` to Environment Variables in the Vercel Dashboard.

---

## 3. Update Backend CORS Origin

After your frontend is live (e.g. `https://routeweather.pages.dev`), update the origin restriction:

1. Update `backend/wrangler.toml`:
   ```toml
   [vars]
   ALLOWED_ORIGIN = "https://routeweather.pages.dev"
   ```
2. Re-deploy the backend:
   ```bash
   cd backend
   npx wrangler deploy
   ```

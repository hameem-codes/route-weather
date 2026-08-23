# RouteWeather 🌤️🚗

[![CI](https://github.com/hameemz/route-nigger/actions/workflows/ci.yml/badge.svg)](https://github.com/hameemz/route-nigger/actions/workflows/ci.yml)

RouteWeather is a full-stack application that calculates driving routes between two cities and provides real-time, checkpoint-based weather forecasts along the route. It uses a React/MapLibre frontend and a Cloudflare Workers backend.

## 🏗️ Architecture
- **Frontend**: React, MapLibre GL JS, Tailwind CSS, Vite.
- **Backend**: Cloudflare Workers, Hono Framework.
- **Geospatial Processing**: Turf.js (on the backend) for calculating checkpoints along the GeoJSON route.

## 📡 API Endpoints

The backend acts as a central orchestration layer, aggregating data from multiple external APIs to prevent the frontend from over-fetching.

### `POST /api/route-weather` (Unified Workflow)
This is the primary endpoint used by the frontend.
- **Input Payload**: `{ "origin": "Seattle", "destination": "Portland", "departureTime": "2024-01-01T12:00:00Z" }`
- **Output**: Returns normalized data including origin/destination coordinates, complete GeoJSON geometry, total distance, duration, and a list of weather checkpoints with expected arrival times.

## 🔄 Data Flow
1. User submits `origin` and `destination` on the frontend.
2. Frontend sends a single `POST` request to the backend.
3. **Backend Geocoding**: Queries OpenStreetMap Nominatim for exact coordinates.
4. **Backend Routing**: Queries OSRM for the fastest driving route geometry.
5. **Route Sampling**: Backend slices the route into evenly spaced checkpoints based on distance (using Turf.js).
6. **Backend Weather**: Queries Open-Meteo for hourly forecasts at all checkpoint coordinates in a single batched request.
7. **Normalization**: Backend aligns expected arrival times at each checkpoint with the corresponding hourly weather forecast.
8. Frontend animates the route and displays interactive weather checkpoints along the map.

## 🚀 External Services & Free-tier Limitations
This project is built strictly using ₹0-cost, free-tier services:
- **Cloudflare Workers**: Generous free tier (100,000 requests/day).
- **OpenStreetMap Nominatim**: Free geocoding. *Limitation: 1 request per second.*
- **Project OSRM**: Free routing engine. *Limitation: Demo server can occasionally timeout or rate-limit under heavy load.*
- **Open-Meteo**: Free weather API for non-commercial use. *Limitation: 10,000 requests/day.*

## ⚡ Caching Strategy
To respect upstream rate limits and improve performance, the backend heavily utilizes the native Cloudflare `caches.default` API:
- **Global Requests** (`/api/route-weather`): Cached for **15 minutes** based on normalized origin, destination, and departure hour.
- **Geocoding & Routing**: Upstream sub-requests are cached for **24 hours**.
- **Weather Data**: Upstream batched weather responses are cached for **15 minutes**.

## 💻 Local Development

### 1. Backend
```bash
cd backend
npm install
npm run dev
```
The backend will run on `http://localhost:8787`.

### 2. Frontend
```bash
# In the root directory
npm install
npm run dev
```
The frontend will run on `http://localhost:5173`. By default, it communicates with the local backend.

## 🌍 Deployment

### 1. Deploy Backend (Cloudflare Workers)
You must have Wrangler authenticated with your Cloudflare account.
```bash
cd backend
npx wrangler login
npm run deploy
```
Copy the resulting `*.workers.dev` URL.

4. Copy `.dev.vars.example` to `.dev.vars` and add your secrets:
```bash
cp .dev.vars.example .dev.vars
```

### Upstash Redis Setup
This backend uses Upstash Redis for caching and rate limiting. To set this up:
1. Go to [Upstash](https://upstash.com/) and create a free Redis database (Global or Regional).
2. Scroll down in the database dashboard to the **REST API** section.
3. Copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. Paste them into your `backend/.dev.vars` file for local development.
5. Add them to your production Cloudflare worker using Wrangler:
```bash
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

### Sentry Integration (Optional)
To track backend errors, add the `SENTRY_DSN` secret to your Cloudflare Worker:
```bash
npx wrangler secret put SENTRY_DSN
```

### 2. Update CORS (Important)
Once your frontend is deployed (e.g., to Vercel, Netlify, or Cloudflare Pages), update the `cors` middleware origin in `backend/src/index.ts` to explicitly allow your production frontend domain, then redeploy the backend.

### 3. Deploy Frontend
Create a `.env` file in the frontend root and add your deployed backend URL:
```env
VITE_API_URL=https://routeweather-api.<your-username>.workers.dev
VITE_SENTRY_DSN=your_frontend_sentry_dsn  # Optional: for frontend error tracking
```
Then build and deploy your frontend using your provider of choice:
```bash
npm run build
```

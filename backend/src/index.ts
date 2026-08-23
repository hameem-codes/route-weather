import { Hono } from 'hono'
import { cors } from 'hono/cors'
import along from '@turf/along';
import distance from '@turf/distance';
import { point, lineString } from '@turf/helpers';
import { fetchGeocode, fetchRoute, fetchWeather, fetchWithTimeout } from './services';
import { rdp, calculateETAs } from './utils/geometry';
import * as Sentry from '@sentry/cloudflare';
import { logger } from './utils/logger';
import { Redis } from '@upstash/redis/cloudflare';
import { drizzle } from 'drizzle-orm/d1';
import { routes, users, watchedRoutes, alerts } from './db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';
import { hashPassword, verifyPassword } from './utils/crypto';
import { getWeatherSeverity } from './utils/weather';

type Bindings = {
  DB: D1Database;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  JWT_SECRET: string;
  ALLOWED_ORIGIN?: string;
  ROUTE_ALERTS_QUEUE: Queue<any>;
};

const getRedis = (c: any) => {
  if (!c.env?.UPSTASH_REDIS_REST_URL) return null;
  return new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });
};

const WORKER_START = new Date().toISOString();

type Variables = {
  userId: string;
  jwtPayload: any;
};

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>();

// Rate Limiting Middleware
app.use('/api/*', async (c, next) => {
  const redis = getRedis(c);
  if (!redis) return next();
  
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const windowStart = now - 60000;
  
  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(`ratelimit:${ip}`, 0, windowStart);
    pipeline.zadd(`ratelimit:${ip}`, { score: now, member: `${now}-${Math.random()}` });
    pipeline.zcard(`ratelimit:${ip}`);
    pipeline.expire(`ratelimit:${ip}`, 60);
    
    const results = await pipeline.exec();
    const requestCount = results[2] as number;
    
    if (requestCount > 30) {
      logger.warn('Rate limit exceeded', { ip });
      return sendError(c, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please try again later', 429);
    }
  } catch (err) {
    logger.error('Redis rate limit error', { error: err });
  }
  
  await next();
});

// 0. Request Logging
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const durationMs = Date.now() - start;
  
  logger.info(`Request handled`, { route: c.req.url, method: c.req.method, status: c.res.status, durationMs });
});

// Global Error Boundary
app.onError((err, c) => {
  Sentry.captureException(err, { extra: { route: c.req.url, method: c.req.method } });
  logger.error(err.message, { errorCode: 'UNHANDLED_EXCEPTION', route: c.req.url });
  return sendError(c, 'INTERNAL_ERROR', 'An unexpected internal error occurred', 500);
});

// Health Check
app.get('/healthz', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: WORKER_START
  });
});

// Standardized error response helper
const sendError = (c: any, code: string, message: string, status: number = 400) => {
  return c.json({
    success: false,
    error: { code, message }
  }, status);
};

const getAllowedOrigin = (c: any) => {
  const allowedEnv = (c.env as any)?.ALLOWED_ORIGIN || 'http://localhost:5173';
  const origins = allowedEnv.split(',').map((o: string) => o.trim());
  const reqOrigin = c.req.header('Origin');
  if (reqOrigin && origins.includes(reqOrigin)) {
    return reqOrigin;
  }
  return origins[0];
};

// 1. Strict CORS Configuration
app.use('/api/*', (c, next) => cors({
  origin: getAllowedOrigin(c),
  allowMethods: ['GET', 'POST', 'OPTIONS', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})(c, next))

// 2. Maximum Request Size limit (10KB)
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'POST') {
    const contentLength = c.req.header('content-length');
    if (contentLength && parseInt(contentLength, 10) > 10240) {
      return sendError(c, 'PAYLOAD_TOO_LARGE', 'Request payload exceeds maximum allowed size (10KB)', 413);
    }
  }
  await next();
});

type NominatimResponse = {
  lat: string;
  lon: string;
  display_name: string;
}

// fetchWithTimeout is now imported from services

app.get('/api/route', async (c) => {
  const originLat = c.req.query('originLat')
  const originLng = c.req.query('originLng')
  const destLat = c.req.query('destLat')
  const destLng = c.req.query('destLng')

  if (!originLat || !originLng || !destLat || !destLng) {
    return sendError(c, 'VALIDATION_ERROR', 'Origin and destination coordinates are required');
  }

  const oLat = parseFloat(originLat);
  const oLng = parseFloat(originLng);
  const dLat = parseFloat(destLat);
  const dLng = parseFloat(destLng);

  if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
    return sendError(c, 'VALIDATION_ERROR', 'Coordinates must be valid numbers');
  }

  if (oLat < -90 || oLat > 90 || dLat < -90 || dLat > 90) return sendError(c, 'VALIDATION_ERROR', 'Latitude must be between -90 and 90');
  if (oLng < -180 || oLng > 180 || dLng < -180 || dLng > 180) return sendError(c, 'VALIDATION_ERROR', 'Longitude must be between -180 and 180');

  const cacheUrl = new URL(c.req.url);
  const cacheKey = cacheUrl.toString();
  const redis = getRedis(c);

  try {
    if (redis) {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        return new Response(JSON.stringify(cachedData), { 
          headers: { 'X-Cache': 'HIT', 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getAllowedOrigin(c) }
        });
      }
    }

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`;
    const osrmRes = await fetchWithTimeout(osrmUrl, {
      headers: {
        'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
        'Referer': 'https://routeweather.com'
      }
    }, 10000);

    if (osrmRes.status === 429) throw new Error('RATE_LIMIT_EXCEEDED');
    if (!osrmRes.ok) throw new Error('UPSTREAM_SERVICE_FAILED');
    
    const osrmData = await osrmRes.json() as any;
    if (osrmData.code !== 'Ok' || !osrmData.routes.length) {
      return sendError(c, 'ROUTE_NOT_FOUND', 'Could not find a valid route between coordinates', 404);
    }

    const route = osrmData.routes[0];

    const result = {
      success: true,
      data: {
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        startCoordinate: [oLng, oLat],
        destinationCoordinate: [dLng, dLat]
      }
    };

    const responseToCache = new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': getAllowedOrigin(c)
      }
    });

    if (redis) {
      c.executionCtx.waitUntil(redis.set(cacheKey, result, { ex: 3600 }));
    }
    return responseToCache;
  } catch (err: any) {
    if (err.name === 'AbortError') return sendError(c, 'UPSTREAM_TIMEOUT', 'Request to routing service timed out', 504);
    if (err.message === 'RATE_LIMIT_EXCEEDED') return sendError(c, 'RATE_LIMIT_EXCEEDED', 'Routing service rate limit exceeded', 429);
    return sendError(c, 'INTERNAL_ERROR', 'An unexpected error occurred while fetching route', 500);
  }
})

app.get('/api/geocode', async (c) => {
  const q = c.req.query('q')
  if (!q || q.trim().length < 2) {
    return sendError(c, 'VALIDATION_ERROR', 'Query must be at least 2 characters long');
  }
  if (q.length > 100) {
    return sendError(c, 'VALIDATION_ERROR', 'Query too long');
  }
  
  const query = q.trim();
  const cacheUrl = new URL(c.req.url);
  cacheUrl.pathname = '/api/geocode';
  cacheUrl.search = `?q=${encodeURIComponent(query.toLowerCase())}`;
  
  const cacheKeyStr = cacheUrl.toString();
  const redis = getRedis(c);

  try {
    if (redis) {
      const cachedData = await redis.get(cacheKeyStr);
      if (cachedData) {
        return new Response(JSON.stringify(cachedData), { 
          headers: { 'X-Cache': 'HIT', 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getAllowedOrigin(c) }
        });
      }
    }

    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetchWithTimeout(nominatimUrl, {
      headers: {
        'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
        'Referer': 'https://routeweather.com'
      }
    }, 8000);

    if (res.status === 429) throw new Error('RATE_LIMIT_EXCEEDED');
    if (!res.ok) throw new Error('UPSTREAM_SERVICE_FAILED');

    const data = await res.json() as NominatimResponse[];
    if (!data || data.length === 0) {
      return sendError(c, 'LOCATION_NOT_FOUND', `Could not find location: ${query}`, 404);
    }

    const result = {
      name: query,
      latitude: parseFloat(data[0].lat),
      longitude: parseFloat(data[0].lon),
      displayName: data[0].display_name
    };

    const responseToCache = new Response(JSON.stringify({ success: true, data: result }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': getAllowedOrigin(c)
      }
    });
    
    if (redis) {
      c.executionCtx.waitUntil(redis.set(cacheKeyStr, data, { ex: 86400 }));
    }
    return responseToCache;
  } catch (err: any) {
    if (err.name === 'AbortError') return sendError(c, 'UPSTREAM_TIMEOUT', 'Request to geocoding service timed out', 504);
    if (err.message === 'RATE_LIMIT_EXCEEDED') return sendError(c, 'RATE_LIMIT_EXCEEDED', 'Geocoding service rate limit exceeded', 429);
    return sendError(c, 'INTERNAL_ERROR', 'An unexpected error occurred during geocoding', 500);
  }
})

app.post('/api/weather/route', async (c) => {
  try {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return sendError(c, 'INVALID_JSON', 'Malformed JSON payload');
    }

    const { geometry, duration, originName, destName } = body;
    
    if (!geometry || !geometry.coordinates || typeof duration !== 'number') {
      return sendError(c, 'VALIDATION_ERROR', 'Valid geometry and duration are required');
    }
    
    const coords = geometry.coordinates;
    if (!Array.isArray(coords) || coords.length === 0) {
      return sendError(c, 'VALIDATION_ERROR', 'Invalid coordinates array');
    }

    const routeLine = lineString(coords);
    let cumulativeDistances = [0];
    for (let i = 1; i < coords.length; i++) {
      cumulativeDistances.push(cumulativeDistances[i-1] + distance(point(coords[i-1]), point(coords[i]), { units: 'miles' }));
    }
    const totalDistanceMi = cumulativeDistances[cumulativeDistances.length - 1];
    const totalTimeMins = Math.round(duration / 60);

    let numSegments = Math.max(3, Math.min(10, Math.ceil(totalDistanceMi / 30)));
    const checkpoints = [];
    
    for (let i = 0; i < numSegments; i++) {
      const dist = (i / (numSegments - 1)) * totalDistanceMi;
      const pt = along(routeLine, dist, { units: 'miles' });
      const timeMins = Math.round((i / (numSegments - 1)) * totalTimeMins);
      
      let locName = `Checkpoint ${i}`;
      if (i === 0 && originName) locName = originName;
      if (i === numSegments - 1 && destName) locName = destName;
      
      checkpoints.push({
        id: `seg_${i}`,
        distanceFromStartMi: dist,
        timeFromStartMins: timeMins,
        locationName: locName,
        coordinates: pt.geometry.coordinates
      });
    }

    const lats = checkpoints.map(c => c.coordinates[1]).join(',');
    const lngs = checkpoints.map(c => c.coordinates[0]).join(',');
    
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility,cloud_cover,weather_code,uv_index&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

    const cacheUrl = new URL(c.req.url);
    const cacheKeyStr = `${cacheUrl.origin}/api/weather/route?hash=${lats.substring(0,10)}-${lngs.substring(0,10)}`;
    const redis = getRedis(c);

    let meteoData;

    try {
      let cachedResponse: any = null;
      if (redis) cachedResponse = await redis.get(cacheKeyStr);

      if (cachedResponse) {
        meteoData = cachedResponse;
      } else {
        const meteoRes = await fetchWithTimeout(meteoUrl, {}, 8000);
        if (meteoRes.status === 429) throw new Error('RATE_LIMIT_EXCEEDED');
        if (!meteoRes.ok) throw new Error('UPSTREAM_SERVICE_FAILED');
        
        meteoData = await meteoRes.json();
        
        if (redis) {
          c.executionCtx.waitUntil(redis.set(cacheKeyStr, meteoData, { ex: 900 }));
        }
      }
    } catch (err) {
      throw err;
    }

    const now = new Date();
    const results = checkpoints.map((cp, idx) => {
      const locationData = Array.isArray(meteoData) ? meteoData[idx] : meteoData;
      const arrivalTime = new Date(now.getTime() + cp.timeFromStartMins * 60000);
      
      const hourly = locationData.hourly;
      let hourIndex = 0;
      let minDiff = Infinity;
      
      hourly.time.forEach((timeStr: string, i: number) => {
        const time = new Date(timeStr);
        const diff = Math.abs(time.getTime() - arrivalTime.getTime());
        if (diff < minDiff) {
          minDiff = diff;
          hourIndex = i;
        }
      });
      
      const wmoCode = hourly.weather_code[hourIndex];
      let condition = "Clear";
      let severity = "safe";
      let icon = "Sun";
      let alert = null;
      let riskAssessment = "Optimal driving conditions.";

      if (wmoCode === 0) { condition = "Clear"; icon = "Sun"; }
      else if (wmoCode === 1 || wmoCode === 2) { condition = "Partly Cloudy"; icon = "Cloud"; }
      else if (wmoCode === 3) { condition = "Overcast"; icon = "Cloud"; }
      else if (wmoCode >= 45 && wmoCode <= 48) { condition = "Fog"; icon = "Cloud"; severity = "warning"; riskAssessment = "Reduced visibility. Drive with caution."; }
      else if (wmoCode >= 51 && wmoCode <= 57) { condition = "Drizzle"; icon = "CloudRain"; }
      else if (wmoCode >= 61 && wmoCode <= 65) { 
        condition = "Rain"; icon = "CloudRain"; severity = "warning"; riskAssessment = "Reduced traction. Increase following distance.";
        if (wmoCode === 65) { condition = "Heavy Rain"; icon = "CloudLightning"; alert = "Heavy Downpour"; riskAssessment = "High risk of hydroplaning."; }
      }
      else if (wmoCode >= 71 && wmoCode <= 77) {
        condition = "Snow"; icon = "Snowflake"; severity = "critical"; riskAssessment = "Severe winter conditions."; alert = "Snow/Ice on roads";
      }
      else if (wmoCode >= 80 && wmoCode <= 82) {
        condition = "Rain Showers"; icon = "CloudRain"; severity = "warning";
      }
      else if (wmoCode >= 85 && wmoCode <= 86) {
        condition = "Snow Showers"; icon = "CloudSnow"; severity = "critical"; alert = "Snow Showers";
      }
      else if (wmoCode >= 95) {
        condition = "Thunderstorm"; icon = "CloudLightning"; severity = "critical"; alert = "Thunderstorm Warning"; riskAssessment = "Dangerous driving conditions.";
      }

      const windSpeed = hourly.wind_speed_10m[hourIndex];
      if (windSpeed > 30) {
        severity = "critical"; alert = "High Wind Warning"; riskAssessment = "Dangerous crosswinds for high-profile vehicles.";
      }
      
      const degreesToDirection = (deg: number) => {
        const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        return dirs[Math.round(deg / 45) % 8];
      };

      return {
        ...cp,
        weather: {
          condition,
          temperatureC: Math.round(hourly.temperature_2m[hourIndex]),
          severity,
          icon,
          rainProbability: hourly.precipitation_probability[hourIndex],
          feelsLikeC: Math.round(hourly.apparent_temperature[hourIndex]),
          humidity: hourly.relative_humidity_2m[hourIndex],
          windSpeedMph: Math.round(windSpeed),
          windDirection: degreesToDirection(hourly.wind_direction_10m[hourIndex]),
          visibilityMi: Math.round((hourly.visibility[hourIndex] / 1609.34) * 10) / 10,
          precipitationIn: hourly.precipitation[hourIndex],
          cloudCover: hourly.cloud_cover[hourIndex],
          uvIndex: hourly.uv_index ? hourly.uv_index[hourIndex] : 0,
          forecastText: `${condition} expected at arrival time.`,
          riskAssessment
        },
        alert
      };
    });

    return c.json({ success: true, data: results });
    
  } catch (err: any) {
    if (err.name === 'AbortError') return sendError(c, 'UPSTREAM_TIMEOUT', 'Request to weather service timed out', 504);
    if (err.message === 'RATE_LIMIT_EXCEEDED') return sendError(c, 'RATE_LIMIT_EXCEEDED', 'Weather service rate limit exceeded', 429);
    return sendError(c, 'INTERNAL_ERROR', 'An unexpected error occurred while processing weather', 500);
  }
});

// Primary Unified Workflow Endpoint
app.post('/api/route-weather', async (c) => {
  let body: any;
  try {
    try {
      body = await c.req.json();
    } catch {
      return sendError(c, 'INVALID_JSON', 'Malformed JSON payload');
    }

    const { origin, destination, departureTime } = body;

    // Strict validation
    if (!origin || typeof origin !== 'string' || origin.trim().length === 0) {
      return sendError(c, 'VALIDATION_ERROR', 'Origin must be a non-empty string');
    }
    if (!destination || typeof destination !== 'string' || destination.trim().length === 0) {
      return sendError(c, 'VALIDATION_ERROR', 'Destination must be a non-empty string');
    }
    
    // Limits
    if (origin.length > 150 || destination.length > 150) {
       return sendError(c, 'VALIDATION_ERROR', 'Origin and destination must be under 150 characters');
    }

    const normOrigin = origin.trim().toLowerCase();
    const normDest = destination.trim().toLowerCase();
    
    let timeKey = "now";
    const startTime = departureTime ? new Date(departureTime) : new Date();
    if (departureTime) {
      if (isNaN(startTime.getTime())) {
        return sendError(c, 'VALIDATION_ERROR', 'Invalid departure time format');
      }
      const nearestHour = new Date(startTime);
      nearestHour.setMinutes(0, 0, 0);
      timeKey = nearestHour.toISOString();
    }

    const redis = getRedis(c);
    const reqUrl = new URL(c.req.url);
    const globalCacheKey = `${reqUrl.origin}/api/route-weather?o=${encodeURIComponent(normOrigin)}&d=${encodeURIComponent(normDest)}&t=${encodeURIComponent(timeKey)}`;

    if (redis) {
      const cachedData = await redis.get(globalCacheKey);
      if (cachedData) {
        return new Response(JSON.stringify(cachedData), { 
          headers: { 'X-Cache': 'HIT', 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getAllowedOrigin(c) }
        });
      }
    }

    // 1. Geocoding
    const geocode = async (query: string): Promise<any> => {
      const normQ = query.trim().toLowerCase();
      const geoCacheKey = `${reqUrl.origin}/api/geocode/internal?q=${encodeURIComponent(normQ)}`;
      
      if (redis) {
        const cachedGeo = await redis.get(geoCacheKey);
        if (cachedGeo) return cachedGeo;
      }

      const result = await fetchGeocode(query);

      if (redis) {
        c.executionCtx.waitUntil(redis.set(geoCacheKey, result, { ex: 86400 }));
      }

      return result;
    };

    const originData = await geocode(origin);
    const destData = await geocode(destination);

    // 2. OSRM routing
    const routeCacheKey = `${reqUrl.origin}/api/route/internal?from=${originData.lng},${originData.lat}&to=${destData.lng},${destData.lat}`;
    let routeResult: any;
    let cachedRoute: any = null;
    if (redis) cachedRoute = await redis.get(routeCacheKey);
    
    if (cachedRoute) {
      routeResult = cachedRoute;
    } else {
      routeResult = await fetchRoute(originData.lng, originData.lat, destData.lng, destData.lat);
      if (redis) {
        c.executionCtx.waitUntil(redis.set(routeCacheKey, routeResult, { ex: 3600 }));
      }
    }

    const { geometry, distanceMeters, durationSeconds, steps, durations, distances } = routeResult;

    // 3. Route sampling (using simplified route to generate points efficiently)
    // We use a small epsilon ~0.005 degrees to reduce redundant points on long straightaways
    const simplifiedCoords = rdp(geometry.coordinates, 0.005);
    const routeLine = lineString(simplifiedCoords);
    
    let cumulativeDistances = [0];
    for (let i = 1; i < simplifiedCoords.length; i++) {
      cumulativeDistances.push(cumulativeDistances[i-1] + distance(point(simplifiedCoords[i-1]), point(simplifiedCoords[i]), { units: 'miles' }));
    }
    const totalDistanceMi = cumulativeDistances[cumulativeDistances.length - 1];

    // Sample dense candidate points (up to 30) along the route
    let numCandidates = Math.max(10, Math.min(30, Math.ceil(totalDistanceMi / 10)));
    const candidates = [];
    const candidateDistancesMeters = [];
    
    for (let i = 0; i < numCandidates; i++) {
      const distMi = (i / (numCandidates - 1)) * totalDistanceMi;
      const pt = along(routeLine, distMi, { units: 'miles' });
      candidateDistancesMeters.push(distMi * 1609.344);
      candidates.push({
        index: i,
        distanceFromStartMi: distMi,
        timeFromStartMins: 0, // Computed below
        coordinates: pt.geometry.coordinates
      });
    }

    // Calculate precise ETAs using the original detailed coordinates and OSRM segment durations
    const etasMins = calculateETAs(geometry.coordinates, durations, distances, candidateDistancesMeters, distanceMeters);
    for (let i = 0; i < candidates.length; i++) {
      candidates[i].timeFromStartMins = etasMins[i];
    }

    // 4. Open-Meteo weather
    const lats = candidates.map(c => c.coordinates[1]).join(',');
    const lngs = candidates.map(c => c.coordinates[0]).join(',');
    
    const weatherCacheKeyStr = `${reqUrl.origin}/api/weather/internal?hash=${lats.substring(0,20)}-${lngs.substring(0,20)}`;
    
    let meteoData;
    let cachedWeather: any = null;
    if (redis) cachedWeather = await redis.get(weatherCacheKeyStr);
    
    if (cachedWeather) {
      meteoData = cachedWeather;
    } else {
      meteoData = await fetchWeather(lats, lngs);
      
      if (redis) {
        c.executionCtx.waitUntil(redis.set(weatherCacheKeyStr, meteoData, { ex: 600 }));
      }
    }

    // 5. Weather normalization
    const candidatesWithWeather = candidates.map((cp, idx) => {
      const locationData = Array.isArray(meteoData) ? meteoData[idx] : meteoData;
      const arrivalTime = new Date(startTime.getTime() + cp.timeFromStartMins * 60000);
      
      const hourly = locationData.hourly;
      let hourIndex = 0;
      let minDiff = Infinity;
      
      hourly.time.forEach((timeStr: string, i: number) => {
        const time = new Date(timeStr);
        const diff = Math.abs(time.getTime() - arrivalTime.getTime());
        if (diff < minDiff) {
          minDiff = diff;
          hourIndex = i;
        }
      });
      
      const wmoCode = hourly.weather_code[hourIndex];
      const windSpeed = hourly.wind_speed_10m[hourIndex];
      const severityInfo = getWeatherSeverity(wmoCode, windSpeed);
      
      const degreesToDirection = (deg: number) => {
        const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
        return dirs[Math.round(deg / 45) % 8];
      };

      return {
        ...cp,
        weather: {
          condition: severityInfo.condition,
          temperatureC: Math.round(hourly.temperature_2m[hourIndex]),
          severity: severityInfo.severity,
          icon: severityInfo.icon, 
          rainProbability: hourly.precipitation_probability[hourIndex],
          feelsLikeC: Math.round(hourly.apparent_temperature[hourIndex]),
          humidity: hourly.relative_humidity_2m[hourIndex],
          windSpeedMph: Math.round(windSpeed),
          windDirection: degreesToDirection(hourly.wind_direction_10m[hourIndex]),
          visibilityMi: Math.round(hourly.visibility[hourIndex] * 0.000621371),
          precipitationIn: hourly.precipitation[hourIndex],
          cloudCover: hourly.cloud_cover[hourIndex],
          uvIndex: hourly.uv_index ? hourly.uv_index[hourIndex] : 0,
          forecastText: `${severityInfo.condition} expected at arrival time.`,
          riskAssessment: severityInfo.riskAssessment
        },
        alert: severityInfo.alert,
        eta: arrivalTime.toISOString()
      };
    });

    // Smart Checkpoint Selection
    let maxCheckpoints = 5;
    if (totalDistanceMi < 50) {
      maxCheckpoints = 3;
    } else if (totalDistanceMi < 150) {
      maxCheckpoints = 5;
    } else if (totalDistanceMi < 400) {
      maxCheckpoints = 7;
    } else {
      maxCheckpoints = 10;
    }

    const selectedIndices: number[] = [0, numCandidates - 1]; // Start and End are always selected
    const candidateScores = candidatesWithWeather.map((c, idx) => {
      if (idx === 0 || idx === numCandidates - 1) return { idx, score: -1 };
      
      const prev = candidatesWithWeather[idx - 1];
      const tempDiff = Math.abs(c.weather.temperatureC - prev.weather.temperatureC);
      const rainChange = (c.weather.rainProbability > 20) !== (prev.weather.rainProbability > 20);
      const severityChange = c.weather.severity !== prev.weather.severity;
      const windDiff = Math.abs(c.weather.windSpeedMph - prev.weather.windSpeedMph);
      const visibilityDiff = Math.abs(c.weather.visibilityMi - prev.weather.visibilityMi);

      let score = 0;
      score += tempDiff * 3;
      if (rainChange) score += 25;
      if (severityChange) score += 20;
      score += windDiff * 0.5;
      score += visibilityDiff * 4;
      return { idx, score };
    });

    let minDistanceIndex = Math.max(1, Math.floor(numCandidates / maxCheckpoints));
    while (selectedIndices.length < maxCheckpoints && minDistanceIndex > 0) {
      let bestIdx = -1;
      let highestScore = -1;
      
      for (const item of candidateScores) {
        if (selectedIndices.includes(item.idx)) continue;
        
        let tooClose = false;
        for (const selIdx of selectedIndices) {
          if (Math.abs(item.idx - selIdx) < minDistanceIndex) {
            tooClose = true;
            break;
          }
        }
        
        if (!tooClose && item.score > highestScore) {
          highestScore = item.score;
          bestIdx = item.idx;
        }
      }
      
      if (bestIdx !== -1) {
        selectedIndices.push(bestIdx);
      } else {
        minDistanceIndex--;
      }
    }

    selectedIndices.sort((a, b) => a - b);

    // OSRM Steps for road name lookup
    const osrmSteps = steps || [];
    const findNearestStepName = (lng: number, lat: number) => {
      if (osrmSteps.length === 0) return '';
      let minDistance = Infinity;
      let nearestStepName = '';
      for (const step of osrmSteps) {
        if (!step.name || step.name.trim() === '') continue;
        const stepLng = step.maneuver.location[0];
        const stepLat = step.maneuver.location[1];
        const dist = Math.pow(stepLng - lng, 2) + Math.pow(stepLat - lat, 2);
        if (dist < minDistance) {
          minDistance = dist;
          nearestStepName = step.name;
        }
      }
      return nearestStepName;
    };

    // Helper for cached reverse geocoding of city/town names
    const getCachedCity = async (lat: number, lng: number) => {
      const cacheLat = lat.toFixed(2);
      const cacheLng = lng.toFixed(2);
      const reverseCacheKey = `${reqUrl.origin}/api/reverse-geocode/internal?lat=${cacheLat}&lng=${cacheLng}`;
      
      if (redis) {
        const cached = await redis.get(reverseCacheKey);
        if (cached) {
          const data = cached as any;
          if (data.city) return data.city;
        }
      }

      try {
        const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
          headers: {
            'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
            'Referer': 'https://routeweather.com'
          }
        }, 3000);
        
        if (res.ok) {
          const json = await res.json() as any;
          const city = json.address?.city || json.address?.town || json.address?.village || json.address?.county || json.address?.state || "Unknown";
          
          if (redis) {
            c.executionCtx.waitUntil(redis.set(reverseCacheKey, { city }, { ex: 86400 }));
          }
          
          return city;
        }
      } catch (e) {
        logger.error('Reverse geocode error', { error: (e as any).message });
      }
      return "Unknown";
    };

    const results = [];
    for (let i = 0; i < selectedIndices.length; i++) {
      const originalIdx = selectedIndices[i];
      const cp = candidatesWithWeather[originalIdx];
      
      let locName = `Checkpoint ${i}`;
      if (i === 0) {
        locName = originData.name;
      } else if (i === selectedIndices.length - 1) {
        locName = destData.name;
      } else {
        const city = await getCachedCity(cp.coordinates[1], cp.coordinates[0]);
        const road = findNearestStepName(cp.coordinates[0], cp.coordinates[1]);
        
        if (city && road) {
          locName = `${city} (via ${road})`;
        } else if (city) {
          locName = city;
        } else if (road) {
          locName = `Near ${road}`;
        } else {
          locName = `Checkpoint ${i}`;
        }
      }
      
      results.push({
        id: `seg_${i}`,
        distanceFromStartMi: cp.distanceFromStartMi,
        timeFromStartMins: cp.timeFromStartMins,
        locationName: locName,
        coordinates: cp.coordinates,
        weather: cp.weather,
        alert: cp.alert,
        eta: cp.eta
      });
    }

    // 6. Final response construction
    const finalResult = {
      success: true,
      data: {
        origin: originData,
        destination: destData,
        geometry,
        distanceMeters,
        durationSeconds,
        checkpoints: results,
      }
    };

    const finalResponse = new Response(JSON.stringify(finalResult), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900', // 15 mins
        'Access-Control-Allow-Origin': getAllowedOrigin(c)
      }
    });

    if (redis) {
      c.executionCtx.waitUntil(redis.set(globalCacheKey, finalResult, { ex: 600 }));
    }

    return finalResponse;

  } catch (err: any) {
    if (err.name === 'AbortError') return sendError(c, 'UPSTREAM_TIMEOUT', 'Request to an upstream service timed out', 504);
    if (err.message === 'RATE_LIMIT_EXCEEDED') return sendError(c, 'RATE_LIMIT_EXCEEDED', 'An upstream service rate limit was exceeded', 429);
    if (err.message.startsWith('LOCATION_NOT_FOUND')) return sendError(c, 'LOCATION_NOT_FOUND', err.message.replace('LOCATION_NOT_FOUND: ', 'Could not find location: '), 404);
    if (err.message === 'ROUTE_NOT_FOUND') return sendError(c, 'ROUTE_NOT_FOUND', 'Could not find a valid driving route', 404);
    
    // Fallback for internal errors
    Sentry.captureException(err, { extra: { route: c.req.url, body: typeof body === 'object' ? { origin: body.origin, destination: body.destination } : undefined } });
    logger.error("Backend Error", { message: err.message, route: c.req.url });
    return sendError(c, 'INTERNAL_ERROR', 'An unexpected internal error occurred', 500);
  }
});

// Auth Endpoints
app.post('/api/auth/signup', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.email || !body.password) return sendError(c, 'VALIDATION_ERROR', 'Email and password required', 400);

    const db = drizzle(c.env.DB);
    const existingUser = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (existingUser.length > 0) return sendError(c, 'CONFLICT', 'Email already in use', 409);

    const passwordHash = await hashPassword(body.password);
    const userId = crypto.randomUUID();

    await db.insert(users).values({
      id: userId,
      email: body.email,
      passwordHash,
      createdAt: new Date()
    });

    const accessToken = await sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 15 * 60 }, c.env.JWT_SECRET);
    const refreshToken = await sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }, c.env.JWT_SECRET);

    const cookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict' as const, path: '/' };
    setCookie(c, 'accessToken', accessToken, cookieOptions);
    setCookie(c, 'refreshToken', refreshToken, cookieOptions);

    return c.json({ success: true, data: { id: userId, email: body.email } });
  } catch (err: any) {
    logger.error('Signup error', { error: err });
    return sendError(c, 'INTERNAL_ERROR', 'Signup failed', 500);
  }
});

app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.email || !body.password) return sendError(c, 'VALIDATION_ERROR', 'Email and password required', 400);

    const db = drizzle(c.env.DB);
    const user = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (user.length === 0) return sendError(c, 'UNAUTHORIZED', 'Invalid credentials', 401);

    const isValid = await verifyPassword(body.password, user[0].passwordHash);
    if (!isValid) return sendError(c, 'UNAUTHORIZED', 'Invalid credentials', 401);

    const accessToken = await sign({ sub: user[0].id, exp: Math.floor(Date.now() / 1000) + 15 * 60 }, c.env.JWT_SECRET);
    const refreshToken = await sign({ sub: user[0].id, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }, c.env.JWT_SECRET);

    const cookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict' as const, path: '/' };
    setCookie(c, 'accessToken', accessToken, cookieOptions);
    setCookie(c, 'refreshToken', refreshToken, cookieOptions);

    return c.json({ success: true, data: { id: user[0].id, email: user[0].email } });
  } catch (err: any) {
    logger.error('Login error', { error: err });
    return sendError(c, 'INTERNAL_ERROR', 'Login failed', 500);
  }
});

app.get('/api/auth/me', async (c) => {
  const token = getCookie(c, 'accessToken');
  if (!token) return sendError(c, 'UNAUTHORIZED', 'No access token', 401);
  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    const userId = payload.sub as string;
    const db = drizzle(c.env.DB);
    const user = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.length === 0) return sendError(c, 'UNAUTHORIZED', 'User not found', 401);
    return c.json({ success: true, data: user[0] });
  } catch (err) {
    return sendError(c, 'UNAUTHORIZED', 'Invalid access token', 401);
  }
});

app.post('/api/auth/refresh', async (c) => {
  try {
    const token = getCookie(c, 'refreshToken');
    if (!token) return sendError(c, 'UNAUTHORIZED', 'No refresh token', 401);

    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    const userId = payload.sub as string;

    const accessToken = await sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 15 * 60 }, c.env.JWT_SECRET);
    const newRefreshToken = await sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }, c.env.JWT_SECRET);
    
    const cookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict' as const, path: '/' };
    setCookie(c, 'accessToken', accessToken, cookieOptions);
    setCookie(c, 'refreshToken', newRefreshToken, cookieOptions);

    return c.json({ success: true });
  } catch (err: any) {
    return sendError(c, 'UNAUTHORIZED', 'Invalid refresh token', 401);
  }
});

app.post('/api/auth/logout', async (c) => {
  const cookieOptions = { httpOnly: true, secure: true, sameSite: 'Strict' as const, path: '/' };
  deleteCookie(c, 'accessToken', cookieOptions);
  deleteCookie(c, 'refreshToken', cookieOptions);
  return c.json({ success: true });
});

// Auth Middleware
const authMiddleware = async (c: any, next: any) => {
  const token = getCookie(c, 'accessToken');
  if (!token) return sendError(c, 'UNAUTHORIZED', 'No access token', 401);

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    c.set('userId', payload.sub as string);
    await next();
  } catch (err) {
    return sendError(c, 'UNAUTHORIZED', 'Invalid access token', 401);
  }
};

// Database endpoints
app.use('/api/routes/*', authMiddleware);
app.use('/api/alerts/*', authMiddleware);

app.post('/api/routes', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();
    
    if (!body.origin || !body.destination || !body.id) {
      return sendError(c, 'VALIDATION_ERROR', 'Origin, destination, and id are required');
    }
    
    await db.insert(routes).values({
      id: body.id,
      userId: c.get('userId') as string,
      origin: body.origin,
      destination: body.destination,
      createdAt: new Date()
    });
    
    return c.json({ success: true, data: { id: body.id } });
  } catch (err: any) {
    logger.error('Failed to save route', { error: err });
    return sendError(c, 'DB_ERROR', 'Failed to save route', 500);
  }
});

app.get('/api/routes', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const userId = c.get('userId') as string;
    // We do a left join to see if the user is watching this route
    const savedRoutes = await db.select({
      id: routes.id,
      origin: routes.origin,
      destination: routes.destination,
      createdAt: routes.createdAt,
      isWatched: watchedRoutes.id,
      thresholdSeverity: watchedRoutes.thresholdSeverity
    })
    .from(routes)
    .leftJoin(watchedRoutes, eq(routes.id, watchedRoutes.routeId as any))
    .where(eq(routes.userId, userId))
    .orderBy(desc(routes.createdAt))
    .limit(50);
    
    return c.json({ success: true, data: savedRoutes.map(r => ({ ...r, isWatched: !!r.isWatched })) });
  } catch (err: any) {
    logger.error('Failed to list routes', { error: err });
    return sendError(c, 'DB_ERROR', 'Failed to list routes', 500);
  }
});

app.delete('/api/routes/:id', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const routeId = c.req.param('id');
    const userId = c.get('userId');
    
    const targetRoute = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
    if (targetRoute.length === 0 || targetRoute[0].userId !== userId) {
      return sendError(c, 'FORBIDDEN', 'Cannot delete this route', 403);
    }
    
    await db.delete(routes).where(eq(routes.id, routeId));
    return c.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to delete route', { error: err });
    return sendError(c, 'DB_ERROR', 'Failed to delete route', 500);
  }
});

app.post('/api/routes/:id/watch', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const routeId = c.req.param('id');
    const userId = c.get('userId') as string;
    const body = await c.req.json();
    
    if (body.thresholdSeverity !== 'warning' && body.thresholdSeverity !== 'critical') {
      return sendError(c, 'VALIDATION_ERROR', 'Invalid threshold severity', 400);
    }
    
    const targetRoute = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
    if (targetRoute.length === 0 || targetRoute[0].userId !== userId) {
      return sendError(c, 'FORBIDDEN', 'Route not found or unowned', 403);
    }
    
    // Upsert equivalent (delete existing then insert)
    await db.delete(watchedRoutes).where(and(eq(watchedRoutes.userId, userId), eq(watchedRoutes.routeId, routeId as any)));
    
    await db.insert(watchedRoutes).values({
      id: crypto.randomUUID(),
      userId,
      routeId,
      thresholdSeverity: body.thresholdSeverity,
      createdAt: new Date()
    });
    
    return c.json({ success: true });
  } catch (err: any) {
    logger.error('Failed to watch route', { error: err });
    return sendError(c, 'DB_ERROR', 'Failed to watch route', 500);
  }
});

app.delete('/api/routes/:id/watch', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const routeId = c.req.param('id');
    const userId = c.get('userId') as string;
    
    await db.delete(watchedRoutes).where(and(eq(watchedRoutes.userId, userId), eq(watchedRoutes.routeId, routeId as any)));
    
    return c.json({ success: true });
  } catch (err: any) {
    return sendError(c, 'DB_ERROR', 'Failed to unwatch route', 500);
  }
});

app.get('/api/alerts', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const userId = c.get('userId') as string;
    const userAlerts = await db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt)).limit(20);
    return c.json({ success: true, data: userAlerts });
  } catch (err: any) {
    return sendError(c, 'DB_ERROR', 'Failed to list alerts', 500);
  }
});

app.post('/api/alerts/:id/read', async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const alertId = c.req.param('id');
    const userId = c.get('userId') as string;
    
    const targetAlert = await db.select().from(alerts).where(eq(alerts.id, alertId as any)).limit(1);
    if (targetAlert.length > 0 && targetAlert[0].userId === userId) {
       await db.update(alerts).set({ read: true }).where(eq(alerts.id, alertId));
    }
    return c.json({ success: true });
  } catch (err: any) {
    return sendError(c, 'DB_ERROR', 'Failed to mark alert as read', 500);
  }
});

export const testApp = app;

export default {
  fetch: Sentry.withSentry((env: any) => ({
    dsn: env?.SENTRY_DSN,
    tracesSampleRate: 1.0,
  }), app).fetch,
  
  async scheduled(event: any, env: Bindings, ctx: ExecutionContext) {
    const db = drizzle(env.DB);
    const watched = await db.select().from(watchedRoutes);
    
    for (const w of watched) {
      await env.ROUTE_ALERTS_QUEUE.send({
        watchedRouteId: w.id,
        routeId: w.routeId,
        userId: w.userId,
        thresholdSeverity: w.thresholdSeverity
      });
    }
  },
  
  async queue(batch: MessageBatch<any>, env: Bindings, ctx: ExecutionContext) {
    const db = drizzle(env.DB);
    for (const message of batch.messages) {
      try {
        const payload = message.body;
        const targetRouteList = await db.select().from(routes).where(eq(routes.id, payload.routeId)).limit(1);
        
        if (targetRouteList.length === 0) {
          message.ack();
          continue;
        }
        
        const targetRoute = targetRouteList[0];
        const originGeo = await fetchGeocode(targetRoute.origin);
        const destGeo = await fetchGeocode(targetRoute.destination);
        
        if (!originGeo || !destGeo) continue;
        
        const routeData = await fetchRoute(originGeo.lng, originGeo.lat, destGeo.lng, destGeo.lat);
        const coords = routeData.geometry.coordinates;
        const lats = coords.map((c: number[]) => c[1]).join(',');
        const lngs = coords.map((c: number[]) => c[0]).join(',');
        
        // Sample just the start, mid, and end for quick background check
        const len = coords.length;
        const sampleCoords = [
          coords[0],
          coords[Math.floor(len / 2)],
          coords[len - 1]
        ];
        
        const sampleLats = sampleCoords.map((c: number[]) => c[1]).join(',');
        const sampleLngs = sampleCoords.map((c: number[]) => c[0]).join(',');
        
        const meteoData = await fetchWeather(sampleLats, sampleLngs) as any;
        
        // Map open-meteo arrays to objects
        const weathers = sampleCoords.map((_, i) => {
          const locData = Array.isArray(meteoData) ? meteoData[i] : meteoData;
          let hourIndex = 0;
          const arrivalTime = new Date();
          let minDiff = Infinity;
          
          if (locData && locData.hourly && locData.hourly.time) {
            locData.hourly.time.forEach((timeStr: string, tIndex: number) => {
              const time = new Date(timeStr);
              const diff = Math.abs(time.getTime() - arrivalTime.getTime());
              if (diff < minDiff) {
                minDiff = diff;
                hourIndex = tIndex;
              }
            });
            const wmoCode = locData.hourly.weather_code[hourIndex];
            const windSpeed = locData.hourly.wind_speed_10m[hourIndex];
            const sevInfo = getWeatherSeverity(wmoCode, windSpeed);
            return { severity: sevInfo.severity };
          }
          return { severity: 'safe' };
        });
        
        // Find if any threshold is crossed
        let alertTriggered = false;
        let worstCond = '';
        for (const w of weathers) {
          if (payload.thresholdSeverity === 'warning' && (w.severity === 'warning' || w.severity === 'critical')) {
            alertTriggered = true; worstCond = 'warning or worse'; break;
          }
          if (payload.thresholdSeverity === 'critical' && w.severity === 'critical') {
             alertTriggered = true; worstCond = 'critical'; break;
          }
        }
        
        if (alertTriggered) {
          // check if we recently sent an alert (within last 3 hours)
          const recentAlerts = await db.select().from(alerts)
            .where(and(eq(alerts.watchedRouteId, payload.watchedRouteId), eq(alerts.read, false)))
            .orderBy(desc(alerts.createdAt))
            .limit(1);
            
          const now = Date.now();
          if (recentAlerts.length === 0 || (now - new Date(recentAlerts[0].createdAt).getTime() > 3 * 60 * 60 * 1000)) {
            await db.insert(alerts).values({
              id: crypto.randomUUID(),
              userId: payload.userId,
              watchedRouteId: payload.watchedRouteId,
              message: `Weather condition deteriorated to ${worstCond} for route ${targetRoute.origin} to ${targetRoute.destination}.`,
              createdAt: new Date()
            });
          }
        }
        
        message.ack();
      } catch (err) {
        logger.error('Queue processing error', { error: err });
        message.retry();
      }
    }
  }
};

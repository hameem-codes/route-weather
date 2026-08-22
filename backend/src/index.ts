import { Hono } from 'hono'
import { cors } from 'hono/cors'
import along from '@turf/along';
import distance from '@turf/distance';
import { point, lineString } from '@turf/helpers';

const app = new Hono()

// Standardized error response helper
const sendError = (c: any, code: string, message: string, status: number = 400) => {
  return c.json({
    success: false,
    error: { code, message }
  }, status);
};

// 1. Strict CORS Configuration
app.use('/api/*', cors({
  origin: 'http://localhost:5173', // Restrict to the exact frontend origin
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}))

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

// Global fetch wrapper with timeout
const fetchWithTimeout = async (url: string, options: any, timeoutMs: number) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

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
  const cacheKey = new Request(cacheUrl.toString());
  const cache = caches.default;

  try {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const newResponse = new Response(cachedResponse.body, cachedResponse);
      newResponse.headers.set('X-Cache', 'HIT');
      return newResponse;
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
        'Access-Control-Allow-Origin': 'http://localhost:5173'
      }
    });

    c.executionCtx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
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
  
  const cacheKey = new Request(cacheUrl.toString());
  const cache = caches.default;

  try {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      const newResponse = new Response(cachedResponse.body, cachedResponse);
      newResponse.headers.set('X-Cache', 'HIT');
      return newResponse;
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
        'Access-Control-Allow-Origin': 'http://localhost:5173'
      }
    });
    
    c.executionCtx.waitUntil(cache.put(cacheKey, responseToCache.clone()));
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
    
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility,cloud_cover,weather_code,uv_index&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

    const cacheUrl = new URL(c.req.url);
    const cacheKeyStr = `${cacheUrl.origin}/api/weather/route?hash=${lats.substring(0,10)}-${lngs.substring(0,10)}`;
    const cacheKey = new Request(cacheKeyStr);
    const cache = caches.default;

    let meteoData;
    const cachedResponse = await cache.match(cacheKey);
    
    if (cachedResponse) {
      meteoData = await cachedResponse.json();
    } else {
      const meteoRes = await fetchWithTimeout(meteoUrl, {}, 8000);
      if (meteoRes.status === 429) throw new Error('RATE_LIMIT_EXCEEDED');
      if (!meteoRes.ok) throw new Error('UPSTREAM_SERVICE_FAILED');
      
      meteoData = await meteoRes.json();
      c.executionCtx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(meteoData), {
        headers: { 'Cache-Control': 'public, max-age=900' }
      })));
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
          temperatureF: Math.round(hourly.temperature_2m[hourIndex]),
          severity,
          icon,
          rainProbability: hourly.precipitation_probability[hourIndex],
          feelsLikeF: Math.round(hourly.apparent_temperature[hourIndex]),
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
  try {
    let body;
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

    const cache = caches.default;
    const reqUrl = new URL(c.req.url);
    const globalCacheKey = new Request(`${reqUrl.origin}/api/route-weather?o=${encodeURIComponent(normOrigin)}&d=${encodeURIComponent(normDest)}&t=${encodeURIComponent(timeKey)}`);

    const cachedResponse = await cache.match(globalCacheKey);
    if (cachedResponse) {
      const res = new Response(cachedResponse.body, cachedResponse);
      res.headers.set('X-Cache', 'HIT');
      return res;
    }

    // 1. Geocoding
    const geocode = async (query: string) => {
      const normQ = query.trim().toLowerCase();
      const geoCacheKey = new Request(`${reqUrl.origin}/api/geocode/internal?q=${encodeURIComponent(normQ)}`);
      
      const cachedGeo = await cache.match(geoCacheKey);
      if (cachedGeo) {
         return cachedGeo.json() as Promise<any>;
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
      if (!data || data.length === 0) throw new Error(`LOCATION_NOT_FOUND: ${query}`);
      
      const result = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        name: data[0].display_name
      };

      c.executionCtx.waitUntil(cache.put(geoCacheKey, new Response(JSON.stringify(result), {
        headers: { 'Cache-Control': 'public, max-age=86400' } // 24 hours
      })));

      return result;
    };

    const originData = await geocode(origin);
    const destData = await geocode(destination);

    // 2. OSRM routing
    const routeCacheKey = new Request(`${reqUrl.origin}/api/route/internal?from=${originData.lng},${originData.lat}&to=${destData.lng},${destData.lat}`);
    let routeResult: any;
    const cachedRoute = await cache.match(routeCacheKey);
    
    if (cachedRoute) {
      routeResult = await cachedRoute.json();
    } else {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originData.lng},${originData.lat};${destData.lng},${destData.lat}?overview=full&geometries=geojson`;
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
        throw new Error('ROUTE_NOT_FOUND');
      }
      const route = osrmData.routes[0];
      
      routeResult = {
        geometry: route.geometry,
        distanceMeters: route.distance,
        durationSeconds: route.duration
      };

      c.executionCtx.waitUntil(cache.put(routeCacheKey, new Response(JSON.stringify(routeResult), {
        headers: { 'Cache-Control': 'public, max-age=86400' }
      })));
    }

    const { geometry, distanceMeters, durationSeconds } = routeResult;

    // 3. Route sampling
    const coords = geometry.coordinates;
    const routeLine = lineString(coords);
    let cumulativeDistances = [0];
    for (let i = 1; i < coords.length; i++) {
      cumulativeDistances.push(cumulativeDistances[i-1] + distance(point(coords[i-1]), point(coords[i]), { units: 'miles' }));
    }
    const totalDistanceMi = cumulativeDistances[cumulativeDistances.length - 1];
    const totalTimeMins = Math.round(durationSeconds / 60);

    let numSegments = Math.max(3, Math.min(10, Math.ceil(totalDistanceMi / 30)));
    const checkpoints = [];
    for (let i = 0; i < numSegments; i++) {
      const dist = (i / (numSegments - 1)) * totalDistanceMi;
      const pt = along(routeLine, dist, { units: 'miles' });
      const timeMins = Math.round((i / (numSegments - 1)) * totalTimeMins);
      
      let locName = `Checkpoint ${i}`;
      if (i === 0) locName = originData.name;
      if (i === numSegments - 1) locName = destData.name;
      
      checkpoints.push({
        id: `seg_${i}`,
        distanceFromStartMi: dist,
        timeFromStartMins: timeMins,
        locationName: locName,
        coordinates: pt.geometry.coordinates
      });
    }

    // 4. Open-Meteo weather
    const lats = checkpoints.map(c => c.coordinates[1]).join(',');
    const lngs = checkpoints.map(c => c.coordinates[0]).join(',');
    
    const weatherCacheKeyStr = `${reqUrl.origin}/api/weather/internal?hash=${lats.substring(0,20)}-${lngs.substring(0,20)}`;
    const weatherCacheKey = new Request(weatherCacheKeyStr);
    
    let meteoData;
    const cachedWeather = await cache.match(weatherCacheKey);
    
    if (cachedWeather) {
      meteoData = await cachedWeather.json();
    } else {
      const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility,cloud_cover,weather_code,uv_index&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
      const meteoRes = await fetchWithTimeout(meteoUrl, {}, 8000);
      
      if (meteoRes.status === 429) throw new Error('RATE_LIMIT_EXCEEDED');
      if (!meteoRes.ok) throw new Error('UPSTREAM_SERVICE_FAILED');
      
      meteoData = await meteoRes.json();
      
      c.executionCtx.waitUntil(cache.put(weatherCacheKey, new Response(JSON.stringify(meteoData), {
        headers: { 'Cache-Control': 'public, max-age=900' }
      })));
    }

    // 5. Weather normalization
    const results = checkpoints.map((cp, idx) => {
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
          temperatureF: Math.round(hourly.temperature_2m[hourIndex]),
          severity,
          icon, 
          rainProbability: hourly.precipitation_probability[hourIndex],
          feelsLikeF: Math.round(hourly.apparent_temperature[hourIndex]),
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
        alert,
        eta: arrivalTime.toISOString()
      };
    });

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
        'Access-Control-Allow-Origin': 'http://localhost:5173'
      }
    });

    c.executionCtx.waitUntil(cache.put(globalCacheKey, finalResponse.clone()));

    return finalResponse;

  } catch (err: any) {
    if (err.name === 'AbortError') return sendError(c, 'UPSTREAM_TIMEOUT', 'Request to an upstream service timed out', 504);
    if (err.message === 'RATE_LIMIT_EXCEEDED') return sendError(c, 'RATE_LIMIT_EXCEEDED', 'An upstream service rate limit was exceeded', 429);
    if (err.message.startsWith('LOCATION_NOT_FOUND')) return sendError(c, 'LOCATION_NOT_FOUND', err.message.replace('LOCATION_NOT_FOUND: ', 'Could not find location: '), 404);
    if (err.message === 'ROUTE_NOT_FOUND') return sendError(c, 'ROUTE_NOT_FOUND', 'Could not find a valid driving route', 404);
    
    // Fallback for internal errors
    console.error("Backend Error:", err);
    return sendError(c, 'INTERNAL_ERROR', 'An unexpected internal error occurred', 500);
  }
});

export default app

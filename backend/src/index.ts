import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('/api/*', cors({
  origin: '*', // Allows frontend to call the API during dev
  allowMethods: ['GET', 'POST', 'OPTIONS'],
}))

type NominatimResponse = {
  lat: string;
  lon: string;
  display_name: string;
}

app.get('/api/route', async (c) => {
  const originLat = c.req.query('originLat')
  const originLng = c.req.query('originLng')
  const destLat = c.req.query('destLat')
  const destLng = c.req.query('destLng')

  if (!originLat || !originLng || !destLat || !destLng) {
    return c.json({ error: 'Origin and destination coordinates (originLat, originLng, destLat, destLng) are required' }, 400)
  }

  // Validate numbers
  const oLat = parseFloat(originLat);
  const oLng = parseFloat(originLng);
  const dLat = parseFloat(destLat);
  const dLng = parseFloat(destLng);

  if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
     return c.json({ error: 'Coordinates must be valid numbers' }, 400)
  }

  // Define cache key
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

    // Call OSRM
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`;
    
    // Setup AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const osrmRes = await fetch(osrmUrl, {
      headers: {
        'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
        'Referer': 'https://routeweather.com'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!osrmRes.ok) {
       const text = await osrmRes.text();
       throw new Error(`OSRM failed: ${osrmRes.status} ${text}`);
    }
    
    const osrmData = await osrmRes.json() as any;
    
    if (osrmData.code !== 'Ok' || !osrmData.routes.length) {
      return c.json({ error: "Route not found" }, 404);
    }

    const route = osrmData.routes[0];

    const result = {
      success: true,
      data: {
        geometry: route.geometry,
        distance: route.distance, // in meters
        duration: route.duration, // in seconds
        startCoordinate: [oLng, oLat],
        destinationCoordinate: [dLng, dLat]
      }
    };

    const responseToCache = new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400', // 24 hours
        'Access-Control-Allow-Origin': '*'
      }
    });

    c.executionCtx.waitUntil(cache.put(cacheKey, responseToCache.clone()));

    return responseToCache;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return c.json({ error: 'Request to routing service timed out' }, 504);
    }
    return c.json({ error: err.message }, 500)
  }
})

app.get('/api/geocode', async (c) => {
  const q = c.req.query('q')
  if (!q) {
    return c.json({ error: 'Query parameter "q" is required' }, 400)
  }
  
  // Clean the query string
  const query = q.trim();
  if (query.length < 2) {
    return c.json({ error: 'Query too short' }, 400)
  }

  // Define cache key based on normalized query
  const cacheUrl = new URL(c.req.url);
  cacheUrl.pathname = '/api/geocode';
  cacheUrl.search = `?q=${encodeURIComponent(query.toLowerCase())}`;
  
  const cacheKey = new Request(cacheUrl.toString());
  // Cloudflare Workers caches.default API
  const cache = caches.default;

  try {
    // Check cache
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      // Adding a custom header just for observability
      const newResponse = new Response(cachedResponse.body, cachedResponse);
      newResponse.headers.set('X-Cache', 'HIT');
      return newResponse;
    }

    // Call Nominatim
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
        'Referer': 'https://routeweather.com'
      }
    });

    if (!res.ok) {
       const text = await res.text();
       throw new Error(`Nominatim failed: ${res.status} ${text}`);
    }

    const data = await res.json() as NominatimResponse[];
    if (!data || data.length === 0) {
      return c.json({ error: 'Location not found' }, 404);
    }

    const result = {
      name: query,
      latitude: parseFloat(data[0].lat),
      longitude: parseFloat(data[0].lon),
      displayName: data[0].display_name
    };

    // Create response
    const responseToCache = new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
        'Access-Control-Allow-Origin': '*'
      }
    });
    
    // Store in cache
    c.executionCtx.waitUntil(cache.put(cacheKey, responseToCache.clone()));

    return responseToCache;
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
})

export default app

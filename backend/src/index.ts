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
  const origin = c.req.query('origin')
  const destination = c.req.query('destination')

  if (!origin || !destination) {
    return c.json({ error: 'Origin and destination are required' }, 400)
  }

  try {
    // 1. Geocode Origin via Nominatim
    const originRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(origin)}&format=json&limit=1`, {
      headers: { 
        'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
        'Referer': 'http://localhost:5173'
      }
    });
    
    if (!originRes.ok) {
       const text = await originRes.text();
       throw new Error(`Nominatim origin failed: ${originRes.status} ${text}`);
    }
    const originData = await originRes.json() as NominatimResponse[];
    if (!originData.length) return c.json({ error: "Origin not found" }, 404);
    const originCoords = [parseFloat(originData[0].lon), parseFloat(originData[0].lat)];

    // Nominatim asks to respect 1 req/sec limit.
    await new Promise(r => setTimeout(r, 1000));

    // 2. Geocode Destination via Nominatim
    const destRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`, {
      headers: { 
        'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
        'Referer': 'http://localhost:5173'
      }
    });
    
    if (!destRes.ok) {
       const text = await destRes.text();
       throw new Error(`Nominatim dest failed: ${destRes.status} ${text}`);
    }
    const destData = await destRes.json() as NominatimResponse[];
    if (!destData.length) return c.json({ error: "Destination not found" }, 404);
    const destCoords = [parseFloat(destData[0].lon), parseFloat(destData[0].lat)];

    // 3. Fetch OSRM Route
    const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${originCoords[0]},${originCoords[1]};${destCoords[0]},${destCoords[1]}?overview=full&geometries=geojson`, {
      headers: {
        'User-Agent': 'RouteWeatherApp/1.0 (support@routeweather.com)',
        'Referer': 'http://localhost:5173'
      }
    });
    if (!osrmRes.ok) {
       const text = await osrmRes.text();
       throw new Error(`OSRM failed: ${osrmRes.status} ${text}`);
    }
    
    const osrmData = await osrmRes.json() as any;
    
    if (osrmData.code !== 'Ok' || !osrmData.routes.length) {
      return c.json({ error: "Route not found" }, 404);
    }

    return c.json({
      success: true,
      data: {
        origin: {
          name: originData[0].display_name,
          coords: originCoords
        },
        destination: {
          name: destData[0].display_name,
          coords: destCoords
        },
        osrm: osrmData
      }
    });

  } catch (err: any) {
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

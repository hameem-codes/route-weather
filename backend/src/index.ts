import { Hono } from 'hono'
import { cors } from 'hono/cors'
import along from '@turf/along';
import distance from '@turf/distance';
import { point, lineString } from '@turf/helpers';

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

app.post('/api/weather/route', async (c) => {
  try {
    const body = await c.req.json();
    const { geometry, duration, originName, destName } = body;
    
    if (!geometry || !geometry.coordinates || !duration) {
      return c.json({ error: 'geometry and duration are required' }, 400);
    }
    
    // 1. Calculate checkpoints based on Turf distance
    const coords = geometry.coordinates;
    const routeLine = lineString(coords);
    let cumulativeDistances = [0];
    for (let i = 1; i < coords.length; i++) {
      cumulativeDistances.push(cumulativeDistances[i-1] + distance(point(coords[i-1]), point(coords[i]), { units: 'miles' }));
    }
    const totalDistanceMi = cumulativeDistances[cumulativeDistances.length - 1];
    const totalTimeMins = Math.round(duration / 60);

    // Determine number of checkpoints (min 3, max 10)
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
        coordinates: pt.geometry.coordinates // [lng, lat]
      });
    }

    // 2. Fetch Open-Meteo
    const lats = checkpoints.map(c => c.coordinates[1]).join(',');
    const lngs = checkpoints.map(c => c.coordinates[0]).join(',');
    
    // Forecast variables
    const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility,cloud_cover,weather_code,uv_index&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

    // Cache handling
    const cacheUrl = new URL(c.req.url);
    const cacheKeyStr = `${cacheUrl.origin}/api/weather/route?hash=${lats.substring(0,10)}-${lngs.substring(0,10)}`;
    const cacheKey = new Request(cacheKeyStr);
    const cache = caches.default;

    let meteoData;
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      meteoData = await cachedResponse.json();
    } else {
      const meteoRes = await fetch(meteoUrl);
      if (!meteoRes.ok) throw new Error(`Open-Meteo failed: ${meteoRes.status}`);
      meteoData = await meteoRes.json();
      
      c.executionCtx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(meteoData), {
        headers: { 'Cache-Control': 'public, max-age=900' } // 15 mins
      })));
    }

    // 3. Map to normalized format
    const now = new Date();
    
    const results = checkpoints.map((cp, idx) => {
      const locationData = Array.isArray(meteoData) ? meteoData[idx] : meteoData;
      const arrivalTime = new Date(now.getTime() + cp.timeFromStartMins * 60000);
      
      // Find closest hourly index
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
          icon, // String name of the icon
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
    return c.json({ error: err.message }, 500);
  }
});

export default app

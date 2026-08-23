export type NominatimResponse = {
  lat: string;
  lon: string;
  display_name: string;
};

// Global fetch wrapper with timeout
export const fetchWithTimeout = async (url: string, options: any, timeoutMs: number) => {
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

export const fetchGeocode = async (query: string) => {
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
  
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    name: data[0].display_name
  };
};

export const fetchRoute = async (oLng: number, oLat: number, dLng: number, dLat: number) => {
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true&annotations=duration,distance`;
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
  
  return {
    geometry: route.geometry,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    steps: route.legs?.[0]?.steps || [],
    durations: route.legs?.[0]?.annotation?.duration || [],
    distances: route.legs?.[0]?.annotation?.distance || [],
  };
};

export const fetchWeather = async (lats: string, lngs: string) => {
  const meteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,relative_humidity_2m,visibility,cloud_cover,weather_code,uv_index&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
  const meteoRes = await fetchWithTimeout(meteoUrl, {}, 8000);
  
  if (meteoRes.status === 429) throw new Error('RATE_LIMIT_EXCEEDED');
  if (!meteoRes.ok) throw new Error('UPSTREAM_SERVICE_FAILED');
  
  return await meteoRes.json();
};

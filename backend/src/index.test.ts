import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchGeocode, fetchRoute, fetchWeather } from './services';
// @ts-ignore
import { testApp as app } from './index';
import worker from './index';

// Mock Crypto utils
vi.mock('./utils/crypto', () => {
  return {
    hashPassword: vi.fn().mockResolvedValue('mocked-hash-123'),
    verifyPassword: vi.fn().mockResolvedValue(true)
  };
});

// Mock the extracted services
vi.mock('./services', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./services')>();
  return {
    ...mod,
    fetchGeocode: vi.fn(),
    fetchRoute: vi.fn(),
    fetchWeather: vi.fn(),
  };
});

// Mock Upstash Redis
vi.mock('@upstash/redis/cloudflare', () => {
  return {
    Redis: vi.fn().mockImplementation(() => {
      return {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        pipeline: vi.fn().mockReturnValue({
          zremrangebyscore: vi.fn(),
          zadd: vi.fn(),
          zcard: vi.fn(),
          expire: vi.fn(),
          exec: vi.fn().mockResolvedValue([null, null, 1]) // returning mock request count
        })
      };
    })
  };
});

// Mock Drizzle
vi.mock('drizzle-orm/d1', () => {
  return {
    drizzle: vi.fn().mockImplementation(() => {
      return {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(true)
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn((table) => {
            return {
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([{ id: 'test-1', origin: 'A', destination: 'B', userId: 'test-user-id' }])
                }),
                // Mock returning empty for signup/login (user not found initially), login test will fail unless we handle it
                limit: vi.fn().mockResolvedValue([{ id: 'test-user-id', email: 'test@example.com', passwordHash: 'mocked-hash-123' }])
              }),
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'test-1', origin: 'A', destination: 'B', userId: 'test-user-id' }])
              })
            };
          })
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(true)
        })
      };
    })
  };
});

describe('POST /api/route-weather', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails with validation error if origin or destination is missing', async () => {
    const res = await app.request('/api/route-weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: 'Seattle' }) // Missing destination
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('handles upstream failures with appropriate status code', async () => {
    vi.mocked(fetchGeocode).mockRejectedValueOnce(new Error('LOCATION_NOT_FOUND: UnknownPlaceXYZ'));

    const res = await app.request('/api/route-weather', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: 'UnknownPlaceXYZ', destination: 'Portland' })
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
  });

  it('returns valid route and weather data for a successful request', async () => {
    vi.mocked(fetchGeocode)
      .mockResolvedValueOnce({ lat: 47.6, lng: -122.3, name: 'Seattle' })
      .mockResolvedValueOnce({ lat: 45.5, lng: -122.6, name: 'Portland' });

    vi.mocked(fetchRoute).mockResolvedValueOnce({
      geometry: { type: 'LineString', coordinates: [[-122.3, 47.6], [-122.6, 45.5]] },
      distanceMeters: 280000,
      durationSeconds: 10800,
      steps: [],
      durations: [],
      distances: []
    });

    vi.mocked(fetchWeather).mockResolvedValueOnce({
      hourly: {
        time: ["2024-01-01T00:00", "2024-01-01T01:00"],
        temperature_2m: [10, 11],
        apparent_temperature: [8, 9],
        precipitation_probability: [0, 0],
        precipitation: [0, 0],
        wind_speed_10m: [5, 5],
        wind_direction_10m: [180, 180],
        relative_humidity_2m: [50, 50],
        visibility: [10000, 10000],
        cloud_cover: [0, 0],
        weather_code: [0, 0],
        uv_index: [1, 1]
      }
    });

    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ address: { city: 'Test City' } })
    } as any);

    const reqCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn()
    };

    const res = await app.fetch(
      new Request('http://localhost/api/route-weather', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: 'Seattle', destination: 'Portland' })
      }),
      {},
      reqCtx as any
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.origin.name).toBe('Seattle');
    expect(json.data.destination.name).toBe('Portland');
    expect(json.data.geometry).toBeDefined();

    fetchMock.mockRestore();
  });
});

describe('Auth Endpoints (/api/auth)', () => {
  const reqCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
  const mockEnv = { DB: {}, JWT_SECRET: 'testsecret' };

  it('POST /api/auth/signup creates a user and returns cookies', async () => {
    const { drizzle } = await import('drizzle-orm/d1');
    vi.mocked(drizzle).mockImplementationOnce(() => ({
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(true) }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) })
        })
      })
    }) as any);

    const res = await app.fetch(new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', password: 'password123' })
    }), mockEnv, reqCtx as any);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(res.headers.get('set-cookie')).toContain('accessToken=');
  });

  it('POST /api/auth/login authenticates a user', async () => {
    const res = await app.fetch(new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
    }), mockEnv, reqCtx as any);
    expect(res.status).toBe(200);
  });
});

describe('Database Endpoints (/api/routes)', () => {
  const reqCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
  const mockEnv = { DB: {}, JWT_SECRET: 'testsecret' };

  let token = '';

  beforeEach(async () => {
    const { sign } = await import('hono/jwt');
    token = await sign({ sub: 'test-user-id', exp: Math.floor(Date.now() / 1000) + 15 * 60 }, 'testsecret');
  });

  it('GET /api/routes rejects unauthenticated requests', async () => {
    const res = await app.request('/api/routes', undefined, mockEnv);
    expect(res.status).toBe(401);
  });
  
  it('GET /api/alerts rejects unauthenticated requests', async () => {
    const res = await app.request('/api/alerts', undefined, mockEnv);
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me returns the correct user when authenticated', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Cookie: `accessToken=${token}` }
    }, mockEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.email).toBe('test@example.com');
  });

  it('POST /api/auth/refresh returns a different refreshToken cookie value', async () => {
    const res = await app.request('/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: `refreshToken=${token}` }
    }, mockEnv);
    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('set-cookie');
    expect(setCookieHeader).toContain('refreshToken=');
    const newRefreshMatch = setCookieHeader?.match(/refreshToken=([^;]+)/);
    expect(newRefreshMatch?.[1]).not.toBe(token);
    expect(newRefreshMatch?.[1]).toBeDefined();
  });
});

describe('Background Queue (worker.queue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly parses a multi-location Open-Meteo response without throwing', async () => {
    vi.mocked(fetchGeocode)
      .mockResolvedValueOnce({ lat: 47.6, lng: -122.3, name: 'Seattle' })
      .mockResolvedValueOnce({ lat: 45.5, lng: -122.6, name: 'Portland' });

    vi.mocked(fetchRoute).mockResolvedValueOnce({
      geometry: { type: 'LineString', coordinates: [[-122.3, 47.6], [-122.4, 46.5], [-122.6, 45.5]] },
      distanceMeters: 280000,
      durationSeconds: 10800,
      steps: [],
      durations: [],
      distances: []
    });

    vi.mocked(fetchWeather).mockResolvedValueOnce([
      { hourly: { time: ["2024-01-01T00:00"], weather_code: [65], wind_speed_10m: [10] } },
      { hourly: { time: ["2024-01-01T00:00"], weather_code: [0], wind_speed_10m: [5] } },
      { hourly: { time: ["2024-01-01T00:00"], weather_code: [71], wind_speed_10m: [15] } }
    ]);
    
    const mockBatch = {
      messages: [{
        body: { routeId: 'route1', userId: 'user1', thresholdSeverity: 'warning' },
        ack: vi.fn()
      }]
    };
    
    const mockEnv = { DB: {} };
    const mockCtx = { waitUntil: vi.fn() };
    
    await expect(worker.queue(mockBatch as any, mockEnv as any, mockCtx as any)).resolves.not.toThrow();
    expect(mockBatch.messages[0].ack).toHaveBeenCalled();
  });
});

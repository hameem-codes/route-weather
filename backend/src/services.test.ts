import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchGeocode, fetchRoute, fetchWeather } from './services';

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchGeocode', () => {
    it('returns parsed location data on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{
          lat: "47.6038",
          lon: "-122.3301",
          display_name: "Seattle, King County, Washington, USA"
        }]
      });

      const result = await fetchGeocode('Seattle');
      expect(result).toEqual({
        lat: 47.6038,
        lng: -122.3301,
        name: "Seattle, King County, Washington, USA"
      });
    });

    it('throws RATE_LIMIT_EXCEEDED on 429', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
      await expect(fetchGeocode('Seattle')).rejects.toThrow('RATE_LIMIT_EXCEEDED');
    });

    it('throws LOCATION_NOT_FOUND if empty results', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => []
      });
      await expect(fetchGeocode('UnknownPlaceXYZ')).rejects.toThrow('LOCATION_NOT_FOUND: UnknownPlaceXYZ');
    });
  });

  describe('fetchRoute', () => {
    it('returns parsed route geometry and metrics on success', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          routes: [{
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
            distance: 1000,
            duration: 500,
            legs: [{ steps: [] }]
          }]
        })
      });

      const result = await fetchRoute(0, 0, 1, 1);
      expect(result).toEqual({
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        distanceMeters: 1000,
        durationSeconds: 500,
        steps: [],
        durations: [],
        distances: []
      });
    });

    it('throws UPSTREAM_SERVICE_FAILED on non-ok', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
      await expect(fetchRoute(0, 0, 1, 1)).rejects.toThrow('UPSTREAM_SERVICE_FAILED');
    });
  });

  describe('fetchWeather', () => {
    it('returns parsed weather data on success', async () => {
      const mockWeather = {
        hourly: {
          time: ["2024-01-01T00:00"],
          temperature_2m: [15]
        }
      };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockWeather
      });

      const result = await fetchWeather('47.6', '-122.3');
      expect(result).toEqual(mockWeather);
    });
  });
});

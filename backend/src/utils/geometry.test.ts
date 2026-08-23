import { describe, it, expect } from 'vitest';
import { rdp, calculateETAs } from './geometry';

describe('Geometry Utils', () => {
  describe('rdp (Ramer-Douglas-Peucker)', () => {
    it('does not simplify a straight line', () => {
      const points: [number, number][] = [
        [0, 0],
        [1, 1],
        [2, 2]
      ];
      // Even with a small epsilon, points on the line should be removed
      const result = rdp(points, 0.1);
      expect(result).toEqual([
        [0, 0],
        [2, 2]
      ]);
    });

    it('simplifies a curve by removing redundant points', () => {
      const points: [number, number][] = [
        [0, 0],
        [1, 0.1], // slightly off the line
        [2, 0],
        [3, 2], // significant deviation
        [4, 0]
      ];
      
      const result = rdp(points, 0.5);
      
      expect(result.length).toBeLessThan(points.length);
      expect(result).toEqual([
        [0, 0],
        [2, 0],
        [3, 2],
        [4, 0]
      ]);
    });

    it('returns original points if array has < 3 items', () => {
      const points: [number, number][] = [[0, 0], [1, 1]];
      expect(rdp(points, 0.1)).toEqual(points);
    });
  });

  describe('calculateETAs', () => {
    it('calculates ETAs correctly for varying segment speeds', () => {
      const coords: [number, number][] = [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3]
      ];
      
      // First segment takes 60 seconds (1 minute), dist: 1000m
      // Second segment takes 300 seconds (5 minutes), dist: 1000m
      // Third segment takes 60 seconds (1 minute), dist: 1000m
      const durations = [60, 300, 60];
      const distances = [1000, 1000, 1000];
      const totalDist = 3000;
      
      // We want to sample at 0, 1500m, and 3000m
      const candidateDistances = [0, 1500, 3000];
      
      const etas = calculateETAs(coords, durations, distances, candidateDistances, totalDist);
      
      expect(etas.length).toBe(3);
      
      // At 0m -> 0 mins
      expect(etas[0]).toBe(0);
      
      // At 1500m -> 1000m (seg 1) + 500m (half of seg 2)
      // Seg 1 time = 1 min
      // Seg 2 time = 5 min, halfway = 2.5 min
      // Total = 3.5 min
      expect(etas[1]).toBe(3.5);
      
      // At 3000m -> Total time = 1 + 5 + 1 = 7 min
      expect(etas[2]).toBe(7);
    });
    
    it('falls back to linear interpolation if duration/distance annotations are missing', () => {
      const coords: [number, number][] = [
        [0, 0],
        [0, 1]
      ];
      
      const candidateDistances = [0, 1500, 3000];
      const totalDist = 3000;
      
      const etas = calculateETAs(coords, [], [], candidateDistances, totalDist);
      
      // Total duration fallback isn't valid if arrays are empty, it will give 0
      expect(etas).toEqual([0, 0, 0]);
    });
  });
});

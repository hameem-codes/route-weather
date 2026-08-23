import { describe, it, expect } from 'vitest';
import { getColorForSeverity, getIconColorClass } from './weatherStyles';

describe('weatherStyles', () => {
  describe('getColorForSeverity', () => {
    it('returns vivid blue for safe', () => {
      expect(getColorForSeverity('safe')).toBe('#3b82f6');
    });

    it('returns deep blue for warning', () => {
      expect(getColorForSeverity('warning')).toBe('#1d4ed8');
    });

    it('returns orange for critical', () => {
      expect(getColorForSeverity('critical')).toBe('#f97316');
    });

    it('returns purple for extreme', () => {
      expect(getColorForSeverity('extreme')).toBe('#a855f7');
    });

    it('returns default color for unknown severity', () => {
      expect(getColorForSeverity('unknown-status')).toBe('#3b82f6');
    });
  });

  describe('getIconColorClass', () => {
    it('returns correct Tailwind classes for safe', () => {
      const result = getIconColorClass('safe');
      expect(result).toContain('bg-blue-500');
      expect(result).toContain('border-blue-400');
    });

    it('returns correct Tailwind classes for warning', () => {
      const result = getIconColorClass('warning');
      expect(result).toContain('bg-blue-700');
      expect(result).toContain('border-blue-500');
    });

    it('returns correct Tailwind classes for critical', () => {
      const result = getIconColorClass('critical');
      expect(result).toContain('bg-orange-500');
      expect(result).toContain('border-orange-400');
    });

    it('returns correct Tailwind classes for extreme', () => {
      const result = getIconColorClass('extreme');
      expect(result).toContain('bg-purple-500');
      expect(result).toContain('border-purple-400');
    });

    it('returns default classes for unknown severity', () => {
      const result = getIconColorClass('unknown');
      expect(result).toContain('bg-zinc-800');
      expect(result).toContain('border-zinc-600');
    });
  });
});

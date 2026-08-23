import { describe, it, expect } from 'vitest';
import { isThresholdCrossed } from './alerts';

describe('Alerts Threshold Logic', () => {
  it('triggers on critical when threshold is critical', () => {
    const { triggered, worstCond } = isThresholdCrossed([
      { severity: 'safe' },
      { severity: 'critical' }
    ], 'critical');
    expect(triggered).toBe(true);
    expect(worstCond).toBe('critical');
  });

  it('does not trigger on warning when threshold is critical', () => {
    const { triggered } = isThresholdCrossed([
      { severity: 'safe' },
      { severity: 'warning' }
    ], 'critical');
    expect(triggered).toBe(false);
  });

  it('triggers on warning when threshold is warning', () => {
    const { triggered, worstCond } = isThresholdCrossed([
      { severity: 'safe' },
      { severity: 'warning' }
    ], 'warning');
    expect(triggered).toBe(true);
    expect(worstCond).toBe('warning or worse');
  });

  it('triggers on critical when threshold is warning', () => {
    const { triggered, worstCond } = isThresholdCrossed([
      { severity: 'safe' },
      { severity: 'critical' }
    ], 'warning');
    expect(triggered).toBe(true);
    expect(worstCond).toBe('warning or worse');
  });

  it('does not trigger on safe when threshold is warning', () => {
    const { triggered } = isThresholdCrossed([
      { severity: 'safe' },
      { severity: 'safe' }
    ], 'warning');
    expect(triggered).toBe(false);
  });
});

export function isThresholdCrossed(weathers: { severity: string }[], threshold: string): { triggered: boolean, worstCond: string } {
  let alertTriggered = false;
  let worstCond = '';
  for (const w of weathers) {
    if (threshold === 'warning' && (w.severity === 'warning' || w.severity === 'critical')) {
      alertTriggered = true; worstCond = 'warning or worse'; break;
    }
    if (threshold === 'critical' && w.severity === 'critical') {
      alertTriggered = true; worstCond = 'critical'; break;
    }
  }
  return { triggered: alertTriggered, worstCond };
}

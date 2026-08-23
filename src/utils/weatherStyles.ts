export const getColorForSeverity = (severity: string) => {
  if (severity === 'safe') return '#3b82f6';
  if (severity === 'warning') return '#1d4ed8';
  if (severity === 'critical') return '#f97316';
  if (severity === 'extreme') return '#a855f7';
  return '#3b82f6';
};

export const getIconColorClass = (severity: string) => {
  if (severity === 'safe') return 'bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.6)] border-blue-400';
  if (severity === 'warning') return 'bg-blue-700 shadow-[0_0_15px_rgba(29,78,216,0.6)] border-blue-500';
  if (severity === 'critical') return 'bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.6)] border-orange-400';
  if (severity === 'extreme') return 'bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.6)] border-purple-400';
  return 'bg-zinc-800 border-zinc-600';
};

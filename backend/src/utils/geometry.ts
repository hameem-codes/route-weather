// Helper to calculate distance between two points in degrees (approximate)
function distanceSquared(p1: [number, number], p2: [number, number]): number {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return dx * dx + dy * dy;
}

// Helper to calculate perpendicular distance from point to line segment
function perpendicularDistanceSquared(pt: [number, number], lineStart: [number, number], lineEnd: [number, number]): number {
  let dx = lineEnd[0] - lineStart[0];
  let dy = lineEnd[1] - lineStart[1];
  
  if (dx === 0 && dy === 0) {
    return distanceSquared(pt, lineStart);
  }

  const t = ((pt[0] - lineStart[0]) * dx + (pt[1] - lineStart[1]) * dy) / (dx * dx + dy * dy);
  
  if (t < 0) {
    return distanceSquared(pt, lineStart);
  } else if (t > 1) {
    return distanceSquared(pt, lineEnd);
  }
  
  const closestPoint: [number, number] = [
    lineStart[0] + t * dx,
    lineStart[1] + t * dy
  ];
  
  return distanceSquared(pt, closestPoint);
}

/**
 * Ramer-Douglas-Peucker route simplification.
 * @param points Array of coordinates [lng, lat]
 * @param epsilon Epsilon for simplification (in degrees). e.g., 0.0001
 * @returns Simplified array of coordinates
 */
export function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points;

  let maxDistSq = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const distSq = perpendicularDistanceSquared(points[i], points[0], points[end]);
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      index = i;
    }
  }

  const epsilonSq = epsilon * epsilon;

  if (maxDistSq > epsilonSq) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [points[0], points[end]];
  }
}

/**
 * Calculates accurate ETAs for candidate distances using OSRM segment durations.
 * @param coords Original coordinate array [lng, lat] from OSRM
 * @param durations Array of durations in seconds for each segment between coords (length: coords.length - 1)
 * @param distances Array of distances in meters for each segment between coords
 * @param candidateDistances Array of target distances (in meters) we want to sample at.
 * @param totalRouteDistanceMeters Total distance of the route in meters.
 * @returns Array of exact ETA in minutes from start for each candidate.
 */
export function calculateETAs(coords: [number, number][], durations: number[], distances: number[], candidateDistances: number[], totalRouteDistanceMeters: number): number[] {
  // If durations/distances are not available, fallback to linear
  if (!durations || !durations.length || durations.length !== coords.length - 1 || distances.length !== coords.length - 1) {
    const totalDurationSeconds = (durations || []).reduce((a, b) => a + b, 0);
    const totalDurationMins = totalDurationSeconds / 60;
    return candidateDistances.map(dist => (dist / totalRouteDistanceMeters) * totalDurationMins);
  }

  let currentDist = 0;
  let currentDurationMins = 0;
  
  const etas: number[] = [];
  let candidateIndex = 0;
  
  for (let i = 0; i < durations.length; i++) {
    const segmentDist = distances[i];
    const segmentDuration = durations[i] / 60; // in minutes
    
    // While we have candidates that fall within the current segment
    while (candidateIndex < candidateDistances.length) {
      const targetDist = candidateDistances[candidateIndex];
      
      if (targetDist <= currentDist + segmentDist + 1e-5 || i === durations.length - 1) {
        // Candidate falls in this segment, interpolate time proportionally to distance covered in this segment
        const distIntoSegment = targetDist - currentDist;
        const ratio = segmentDist > 0 ? Math.max(0, Math.min(1, distIntoSegment / segmentDist)) : 0;
        const eta = currentDurationMins + (ratio * segmentDuration);
        etas.push(eta);
        candidateIndex++;
      } else {
        break; // Move to next segment
      }
    }
    
    currentDist += segmentDist;
    currentDurationMins += segmentDuration;
  }
  
  // Fill any remaining candidates (e.g., due to floating point inaccuracies at the very end)
  while (candidateIndex < candidateDistances.length) {
    etas.push(currentDurationMins);
    candidateIndex++;
  }
  
  return etas;
}

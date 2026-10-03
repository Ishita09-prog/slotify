/** Convex hull (Andrew's monotone chain) of lat/lng points, padded outward by `padKm`. */
export function paddedHull(points: { lat: number; lng: number }[], padKm = 0.6): [number, number][] {
  if (points.length === 0) return [];
  const kmLat = 1 / 110.57;
  const kmLng = 1 / (111.32 * Math.cos((points[0].lat * Math.PI) / 180));
  // pad by adding a ring of 12 points around each input point, then take the hull
  const ring: [number, number][] = [];
  for (const p of points)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ring.push([p.lng + Math.cos(a) * padKm * kmLng, p.lat + Math.sin(a) * padKm * kmLat]);
    }
  const pts = ring.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(([lng, lat]) => [lat, lng]);
}

export function centroid(points: { lat: number; lng: number }[]) {
  return {
    lat: points.reduce((a, p) => a + p.lat, 0) / Math.max(1, points.length),
    lng: points.reduce((a, p) => a + p.lng, 0) / Math.max(1, points.length),
  };
}

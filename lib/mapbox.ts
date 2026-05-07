/**
 * Mapbox Matrix API helper — converts straight-line haversine distances
 * into real driving distances. Uses the Matrix API which accepts up to
 * 25 coordinates per request (1 origin + 24 destinations) — much more
 * efficient than calling Directions API once per hotel.
 *
 * Cost: free tier 50K requests/month. Each batch of up to 24 hotels is
 * ONE request, so we can serve roughly 2,000+ driver visits/month for
 * free at the average 20-hotels-per-page level.
 *
 * Token comes from NEXT_PUBLIC_MAPBOX_TOKEN env var. If missing or call
 * fails, callers should fall back to haversine (existing 1.25× behavior).
 */

export type MapboxOrigin = { lat: number; lng: number }
export type MapboxDestination = { id: string; lat: number; lng: number }
export type DrivingDistance = { id: string; miles: number; minutes: number }

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

/**
 * Get real driving distances + ETAs from origin to each destination.
 * Returns null entries for destinations Mapbox couldn't route to (rare —
 * usually only when coords are off-road or in water).
 *
 * @param origin   driver's GPS lat/lng
 * @param dests    up to 24 destinations (any more will be silently dropped)
 */
export async function getDrivingDistances(
  origin: MapboxOrigin,
  dests: MapboxDestination[],
): Promise<Map<string, DrivingDistance>> {
  const result = new Map<string, DrivingDistance>()
  if (!MAPBOX_TOKEN || dests.length === 0) return result

  // Mapbox Matrix API limit is 25 total coordinates (1 origin + 24 dests).
  // Trim if caller passes more — they should batch externally if needed.
  const limited = dests.slice(0, 24)

  // Build coordinate string: lng,lat;lng,lat;... (Mapbox uses lng-first)
  const coords = [
    `${origin.lng},${origin.lat}`,
    ...limited.map(d => `${d.lng},${d.lat}`),
  ].join(';')

  // sources=0 means: only use index 0 (origin) as a source
  // destinations=1;2;3;... means: compute distances TO each of these
  const destIndexes = limited.map((_, i) => i + 1).join(';')
  const url = `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}` +
    `?sources=0&destinations=${destIndexes}` +
    `&annotations=distance,duration` +
    `&access_token=${MAPBOX_TOKEN}`

  try {
    const res = await fetch(url)
    if (!res.ok) {
      // Common reasons: rate limit, expired token, invalid coords.
      // Return empty map → caller falls back to haversine.
      return result
    }
    const data = await res.json()
    // distances[0] is array of distances from source 0 to each destination
    // (in meters). durations[0] same shape (in seconds).
    const dist: (number | null)[] = data.distances?.[0] || []
    const dur:  (number | null)[] = data.durations?.[0] || []
    limited.forEach((d, i) => {
      const meters = dist[i]
      const seconds = dur[i]
      if (meters != null && seconds != null) {
        result.set(d.id, {
          id: d.id,
          miles:   meters / 1609.344,         // m -> mi
          minutes: seconds / 60,              // s -> min
        })
      }
    })
  } catch {
    // Network error, parse error, etc. — return empty map.
  }
  return result
}

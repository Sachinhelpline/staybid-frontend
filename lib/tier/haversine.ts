// ═══════════════════════════════════════════════════════════════════════════
// Haversine distance — great-circle distance between two lat/lng points.
// Used by Community Contributor location-OTP flow to check that the
// customer's device is within 250m of the hotel before issuing an OTP.
// ═══════════════════════════════════════════════════════════════════════════
// Pure function. No I/O. No Supabase. No env access.

const EARTH_RADIUS_M = 6_371_000; // mean radius in meters

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Distance in meters between two coordinates on Earth's surface.
 * Returns Infinity if any input is non-finite (callers can treat that
 * as "too far" without an extra NaN check).
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Geofence default: 250m radius. A hotel within 250m of the customer's
 * device is considered "on-site". Adjustable per-call.
 */
export const LOCATION_OTP_RADIUS_M = 250;

export function isWithinGeofence(
  deviceLat: number,
  deviceLng: number,
  hotelLat: number,
  hotelLng: number,
  radiusM: number = LOCATION_OTP_RADIUS_M
): boolean {
  return haversineMeters(deviceLat, deviceLng, hotelLat, hotelLng) <= radiusM;
}

/**
 * Geolocation capture and auto-tagging for workspace access proofs.
 *
 * Pure functions for:
 * - Getting current location via navigator.geolocation
 * - Haversine distance calculation
 * - Auto-tagging locations within 200m radius
 * - Matching against saved locations and office zones
 * - Flagging low-accuracy readings (>1km)
 *
 * Requirements: Task 18.2, 18.3
 */

import type { WorkspaceLocation, OfficeZone } from "@/types";

/** Result of a geolocation capture */
export interface GeoLocationResult {
  lat: number;
  lng: number;
  accuracy: number; // meters
  lowAccuracy: boolean; // true if accuracy > 1000m
}

/** Result of matching a location against saved locations / office zones */
export interface LocationMatchResult {
  matched: boolean;
  locationId: string | null;
  locationName: string | null;
  isOfficeZone: boolean;
  promptForNewName: boolean;
}

/** Earth radius in meters */
const EARTH_RADIUS_M = 6_371_000;

/** Default matching radius in meters */
const DEFAULT_MATCH_RADIUS_M = 200;

/** Low accuracy threshold in meters */
const LOW_ACCURACY_THRESHOLD_M = 1000;

/**
 * Convert degrees to radians.
 */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Compute the Haversine distance between two lat/lng points.
 * Returns distance in meters.
 *
 * @param lat1 - Latitude of point 1 (degrees)
 * @param lng1 - Longitude of point 1 (degrees)
 * @param lat2 - Latitude of point 2 (degrees)
 * @param lng2 - Longitude of point 2 (degrees)
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Check if a geolocation reading has low accuracy (>1km).
 *
 * @param accuracy - Accuracy in meters
 * @returns true if accuracy exceeds 1000m threshold
 */
export function isLowAccuracy(accuracy: number): boolean {
  return accuracy > LOW_ACCURACY_THRESHOLD_M;
}

/**
 * Get the current device location via navigator.geolocation.
 * Returns a promise that resolves with lat, lng, accuracy.
 * Falls back to null if geolocation is unavailable or denied.
 */
export function getCurrentLocation(): Promise<GeoLocationResult | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        resolve({
          lat: latitude,
          lng: longitude,
          accuracy,
          lowAccuracy: isLowAccuracy(accuracy),
        });
      },
      () => {
        // Permission denied or error — fallback to manual selection
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    );
  });
}

/**
 * Match a lat/lng against saved workspace locations and team office zones.
 *
 * Logic:
 * 1. Check against team office zones first — if within zone radius, tag as that office
 * 2. Check against user's saved locations — if within location radius (default 200m), auto-tag
 * 3. If no match → prompt for new location name
 *
 * @param lat - Current latitude
 * @param lng - Current longitude
 * @param savedLocations - User's saved workspace locations
 * @param officeZones - Team's office zones
 * @returns Match result with location info or prompt flag
 */
export function matchOrCreateLocation(
  lat: number,
  lng: number,
  savedLocations: WorkspaceLocation[],
  officeZones: OfficeZone[],
): LocationMatchResult {
  // 1. Check office zones first (team-level)
  for (const zone of officeZones) {
    const distance = haversineDistance(lat, lng, zone.lat, zone.lng);
    if (distance <= zone.radiusMeters) {
      return {
        matched: true,
        locationId: zone.id,
        locationName: zone.name,
        isOfficeZone: true,
        promptForNewName: false,
      };
    }
  }

  // 2. Check saved locations (user-level)
  let closestLocation: WorkspaceLocation | null = null;
  let closestDistance = Infinity;

  for (const loc of savedLocations) {
    const distance = haversineDistance(lat, lng, loc.lat, loc.lng);
    const matchRadius = loc.radiusMeters > 0 ? loc.radiusMeters : DEFAULT_MATCH_RADIUS_M;
    if (distance <= matchRadius && distance < closestDistance) {
      closestLocation = loc;
      closestDistance = distance;
    }
  }

  if (closestLocation) {
    return {
      matched: true,
      locationId: closestLocation.id,
      locationName: closestLocation.name,
      isOfficeZone: closestLocation.isOfficeZone,
      promptForNewName: false,
    };
  }

  // 3. No match — prompt for new name
  return {
    matched: false,
    locationId: null,
    locationName: null,
    isOfficeZone: false,
    promptForNewName: true,
  };
}

/**
 * Office zone management for workspace access proofs.
 *
 * Pure functions for:
 * - CRUD operations on office zones
 * - Checking if a lat/lng is within any office zone
 *
 * Requirements: Task 18.11
 */

import type { OfficeZone } from "@/types";
import { haversineDistance } from "@/lib/geolocation";

/** Default office zone radius in meters */
const DEFAULT_ZONE_RADIUS_M = 500;

/**
 * Create a new OfficeZone record.
 *
 * @param id - Unique identifier
 * @param teamId - Team this zone belongs to
 * @param name - Zone name (e.g. "Kenesis HQ")
 * @param lat - Latitude of zone center
 * @param lng - Longitude of zone center
 * @param radiusMeters - Zone radius in meters (default 500)
 * @param createdBy - User ID of the creator
 * @returns A new OfficeZone record
 */
export function createOfficeZone(
  id: string,
  teamId: string,
  name: string,
  lat: number,
  lng: number,
  radiusMeters: number = DEFAULT_ZONE_RADIUS_M,
  createdBy: string,
): OfficeZone {
  if (!name || name.trim().length === 0) {
    throw new Error("Office zone name is required");
  }

  if (radiusMeters <= 0) {
    throw new Error("Radius must be positive");
  }

  return {
    id,
    teamId,
    name: name.trim(),
    lat,
    lng,
    radiusMeters,
    createdBy,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Update an existing office zone's properties.
 *
 * @param zone - The existing zone to update
 * @param updates - Partial updates to apply
 * @returns A new OfficeZone with updates applied
 */
export function updateOfficeZone(
  zone: OfficeZone,
  updates: Partial<Pick<OfficeZone, "name" | "lat" | "lng" | "radiusMeters">>,
): OfficeZone {
  const name = updates.name !== undefined ? updates.name.trim() : zone.name;
  if (!name || name.length === 0) {
    throw new Error("Office zone name is required");
  }

  const radius = updates.radiusMeters !== undefined ? updates.radiusMeters : zone.radiusMeters;
  if (radius <= 0) {
    throw new Error("Radius must be positive");
  }

  return {
    ...zone,
    name,
    lat: updates.lat !== undefined ? updates.lat : zone.lat,
    lng: updates.lng !== undefined ? updates.lng : zone.lng,
    radiusMeters: radius,
  };
}

/** Result of checking if a point is within an office zone */
export interface OfficeZoneCheckResult {
  inZone: boolean;
  zoneName?: string;
  zoneId?: string;
}

/**
 * Check if a lat/lng point is within any of the given office zones.
 *
 * @param lat - Latitude to check
 * @param lng - Longitude to check
 * @param zones - Array of office zones to check against
 * @returns Result indicating if the point is in a zone and which one
 */
export function isWithinOfficeZone(
  lat: number,
  lng: number,
  zones: OfficeZone[],
): OfficeZoneCheckResult {
  for (const zone of zones) {
    const distance = haversineDistance(lat, lng, zone.lat, zone.lng);
    if (distance <= zone.radiusMeters) {
      return {
        inZone: true,
        zoneName: zone.name,
        zoneId: zone.id,
      };
    }
  }

  return { inZone: false };
}

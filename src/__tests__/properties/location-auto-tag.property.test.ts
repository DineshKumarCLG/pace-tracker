import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { haversineDistance, matchOrCreateLocation } from "@/lib/geolocation";
import type { WorkspaceLocation, OfficeZone } from "@/types";

/**
 * Property 40: Location auto-tag within radius
 *
 * For any lat/lng pair and set of saved locations, if the point is within
 * 200m of a saved location it should be auto-tagged with that location's name.
 * If outside all saved location radii, it should prompt for a new name.
 *
 * **Validates: Requirements 18.3**
 */

// --- Helpers ---

function makeLocation(
  id: string,
  name: string,
  lat: number,
  lng: number,
  radiusMeters: number = 200,
): WorkspaceLocation {
  return {
    id,
    userId: "user-1",
    name,
    lat,
    lng,
    radiusMeters,
    isOfficeZone: false,
    createdAt: Date.now(),
  };
}

function makeOfficeZone(
  id: string,
  name: string,
  lat: number,
  lng: number,
  radiusMeters: number = 500,
): OfficeZone {
  return {
    id,
    teamId: "team-1",
    name,
    lat,
    lng,
    radiusMeters,
    createdBy: "user-1",
    createdAt: Date.now(),
  };
}

/**
 * Offset a lat/lng by approximately `meters` in a random direction.
 * Uses a simple equirectangular approximation (good enough for small distances).
 */
function offsetLatLng(
  lat: number,
  lng: number,
  meters: number,
  bearingDeg: number,
): { lat: number; lng: number } {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(bearingRad)) / 111_320;
  const dLng =
    (meters * Math.sin(bearingRad)) /
    (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

// --- Arbitraries ---

const latArb = fc.double({ min: -85, max: 85, noNaN: true, noDefaultInfinity: true });
const lngArb = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });
const bearingArb = fc.double({ min: 0, max: 360, noNaN: true, noDefaultInfinity: true });

// --- Property Tests ---

describe("Property 40: Location auto-tag within radius", () => {
  it("point within 200m of saved location → auto-tagged (Req 18.3)", () => {
    fc.assert(
      fc.property(
        latArb,
        lngArb,
        fc.integer({ min: 1, max: 150 }), // distance well within 200m
        bearingArb,
        (baseLat, baseLng, distMeters, bearing) => {
          const location = makeLocation("loc-1", "Kenesis HQ", baseLat, baseLng, 200);
          const point = offsetLatLng(baseLat, baseLng, distMeters, bearing);

          // Verify the point is actually within 200m
          const actualDist = haversineDistance(baseLat, baseLng, point.lat, point.lng);
          if (actualDist > 200) return; // skip edge cases from approximation

          const result = matchOrCreateLocation(point.lat, point.lng, [location], []);

          expect(result.matched).toBe(true);
          expect(result.locationName).toBe("Kenesis HQ");
          expect(result.promptForNewName).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("point outside 200m of all saved locations → prompts for new name (Req 18.3)", () => {
    fc.assert(
      fc.property(
        latArb,
        lngArb,
        fc.integer({ min: 500, max: 5000 }), // well outside 200m
        bearingArb,
        (baseLat, baseLng, distMeters, bearing) => {
          const location = makeLocation("loc-1", "Kenesis HQ", baseLat, baseLng, 200);
          const point = offsetLatLng(baseLat, baseLng, distMeters, bearing);

          // Verify the point is actually outside 200m
          const actualDist = haversineDistance(baseLat, baseLng, point.lat, point.lng);
          if (actualDist <= 200) return; // skip edge cases

          const result = matchOrCreateLocation(point.lat, point.lng, [location], []);

          expect(result.matched).toBe(false);
          expect(result.promptForNewName).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("office zone takes priority over saved location (Req 18.3)", () => {
    fc.assert(
      fc.property(latArb, lngArb, (baseLat, baseLng) => {
        const location = makeLocation("loc-1", "Home Office", baseLat, baseLng, 200);
        const zone = makeOfficeZone("zone-1", "Kenesis HQ", baseLat, baseLng, 500);

        const result = matchOrCreateLocation(baseLat, baseLng, [location], [zone]);

        // Office zone should take priority
        expect(result.matched).toBe(true);
        expect(result.locationName).toBe("Kenesis HQ");
        expect(result.isOfficeZone).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("haversine distance is non-negative and symmetric", () => {
    fc.assert(
      fc.property(latArb, lngArb, latArb, lngArb, (lat1, lng1, lat2, lng2) => {
        const d1 = haversineDistance(lat1, lng1, lat2, lng2);
        const d2 = haversineDistance(lat2, lng2, lat1, lng1);

        expect(d1).toBeGreaterThanOrEqual(0);
        expect(d1).toBeCloseTo(d2, 6); // symmetric
      }),
      { numRuns: 200 },
    );
  });

  it("haversine distance from a point to itself is 0", () => {
    fc.assert(
      fc.property(latArb, lngArb, (lat, lng) => {
        expect(haversineDistance(lat, lng, lat, lng)).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

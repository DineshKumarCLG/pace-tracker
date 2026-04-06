import { describe, it, expect } from "vitest";
import {
  haversineDistance,
  toRadians,
  isLowAccuracy,
  matchOrCreateLocation,
} from "@/lib/geolocation";
import type { WorkspaceLocation, OfficeZone } from "@/types";

// --- Helpers ---

function makeLocation(
  id: string,
  name: string,
  lat: number,
  lng: number,
  radiusMeters: number = 200,
): WorkspaceLocation {
  return { id, userId: "user-1", name, lat, lng, radiusMeters, isOfficeZone: false, createdAt: 1000 };
}

function makeZone(
  id: string,
  name: string,
  lat: number,
  lng: number,
  radiusMeters: number = 500,
): OfficeZone {
  return { id, teamId: "team-1", name, lat, lng, radiusMeters, createdBy: "user-1", createdAt: 1000 };
}

describe("toRadians", () => {
  it("converts 0 degrees to 0 radians", () => {
    expect(toRadians(0)).toBe(0);
  });

  it("converts 180 degrees to PI radians", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 10);
  });

  it("converts 90 degrees to PI/2 radians", () => {
    expect(toRadians(90)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("haversineDistance", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistance(12.97, 77.59, 12.97, 77.59)).toBe(0);
  });

  it("computes known distance (Bangalore to Chennai ~290km)", () => {
    const dist = haversineDistance(12.97, 77.59, 13.08, 80.27);
    expect(dist).toBeGreaterThan(280_000);
    expect(dist).toBeLessThan(310_000);
  });

  it("is symmetric", () => {
    const d1 = haversineDistance(12.97, 77.59, 13.08, 80.27);
    const d2 = haversineDistance(13.08, 80.27, 12.97, 77.59);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it("returns non-negative values", () => {
    expect(haversineDistance(0, 0, 90, 180)).toBeGreaterThanOrEqual(0);
  });
});

describe("isLowAccuracy", () => {
  it("returns false for accuracy <= 1000m", () => {
    expect(isLowAccuracy(50)).toBe(false);
    expect(isLowAccuracy(1000)).toBe(false);
  });

  it("returns true for accuracy > 1000m", () => {
    expect(isLowAccuracy(1001)).toBe(true);
    expect(isLowAccuracy(5000)).toBe(true);
  });
});

describe("matchOrCreateLocation", () => {
  it("matches saved location within radius", () => {
    const loc = makeLocation("loc-1", "Home Office", 12.97, 77.59);
    const result = matchOrCreateLocation(12.97, 77.59, [loc], []);

    expect(result.matched).toBe(true);
    expect(result.locationName).toBe("Home Office");
    expect(result.promptForNewName).toBe(false);
  });

  it("prompts for new name when no match", () => {
    const loc = makeLocation("loc-1", "Home Office", 12.97, 77.59);
    // Point far away
    const result = matchOrCreateLocation(13.08, 80.27, [loc], []);

    expect(result.matched).toBe(false);
    expect(result.promptForNewName).toBe(true);
  });

  it("office zone takes priority over saved location", () => {
    const loc = makeLocation("loc-1", "Home", 12.97, 77.59);
    const zone = makeZone("zone-1", "Kenesis HQ", 12.97, 77.59);

    const result = matchOrCreateLocation(12.97, 77.59, [loc], [zone]);

    expect(result.matched).toBe(true);
    expect(result.locationName).toBe("Kenesis HQ");
    expect(result.isOfficeZone).toBe(true);
  });

  it("returns closest saved location when multiple match", () => {
    const loc1 = makeLocation("loc-1", "Far Office", 12.97, 77.59, 500);
    const loc2 = makeLocation("loc-2", "Near Office", 12.9701, 77.5901, 500);

    // Point very close to loc2
    const result = matchOrCreateLocation(12.9701, 77.5901, [loc1, loc2], []);

    expect(result.matched).toBe(true);
    expect(result.locationName).toBe("Near Office");
  });

  it("handles empty locations and zones", () => {
    const result = matchOrCreateLocation(12.97, 77.59, [], []);

    expect(result.matched).toBe(false);
    expect(result.promptForNewName).toBe(true);
  });
});

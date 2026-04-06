import { describe, it, expect } from "vitest";
import {
  createOfficeZone,
  updateOfficeZone,
  isWithinOfficeZone,
} from "@/lib/officeZones";
import type { OfficeZone } from "@/types";

// --- Helpers ---

function makeZone(
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
    createdAt: 1_700_000_000,
  };
}

describe("createOfficeZone", () => {
  it("creates a zone with correct fields", () => {
    const zone = createOfficeZone("z-1", "team-1", "Kenesis HQ", 12.97, 77.59, 500, "user-1");

    expect(zone.id).toBe("z-1");
    expect(zone.name).toBe("Kenesis HQ");
    expect(zone.lat).toBe(12.97);
    expect(zone.lng).toBe(77.59);
    expect(zone.radiusMeters).toBe(500);
    expect(zone.teamId).toBe("team-1");
  });

  it("uses default radius of 500m", () => {
    const zone = createOfficeZone("z-1", "team-1", "Office", 0, 0, undefined, "user-1");
    expect(zone.radiusMeters).toBe(500);
  });

  it("trims whitespace from name", () => {
    const zone = createOfficeZone("z-1", "team-1", "  HQ  ", 0, 0, 500, "user-1");
    expect(zone.name).toBe("HQ");
  });

  it("throws on empty name", () => {
    expect(() => createOfficeZone("z-1", "team-1", "", 0, 0, 500, "user-1")).toThrow(
      "Office zone name is required",
    );
  });

  it("throws on zero radius", () => {
    expect(() => createOfficeZone("z-1", "team-1", "HQ", 0, 0, 0, "user-1")).toThrow(
      "Radius must be positive",
    );
  });

  it("throws on negative radius", () => {
    expect(() => createOfficeZone("z-1", "team-1", "HQ", 0, 0, -100, "user-1")).toThrow(
      "Radius must be positive",
    );
  });
});

describe("updateOfficeZone", () => {
  const zone = makeZone("z-1", "Old Name", 12.97, 77.59, 500);

  it("updates name", () => {
    const updated = updateOfficeZone(zone, { name: "New Name" });
    expect(updated.name).toBe("New Name");
    expect(updated.lat).toBe(12.97); // unchanged
  });

  it("updates lat/lng", () => {
    const updated = updateOfficeZone(zone, { lat: 13.0, lng: 78.0 });
    expect(updated.lat).toBe(13.0);
    expect(updated.lng).toBe(78.0);
  });

  it("updates radius", () => {
    const updated = updateOfficeZone(zone, { radiusMeters: 1000 });
    expect(updated.radiusMeters).toBe(1000);
  });

  it("throws on empty name update", () => {
    expect(() => updateOfficeZone(zone, { name: "" })).toThrow("Office zone name is required");
  });

  it("throws on zero radius update", () => {
    expect(() => updateOfficeZone(zone, { radiusMeters: 0 })).toThrow("Radius must be positive");
  });
});

describe("isWithinOfficeZone", () => {
  it("returns inZone=true when point is within zone radius", () => {
    const zones = [makeZone("z-1", "Kenesis HQ", 12.97, 77.59, 500)];
    const result = isWithinOfficeZone(12.97, 77.59, zones);

    expect(result.inZone).toBe(true);
    expect(result.zoneName).toBe("Kenesis HQ");
    expect(result.zoneId).toBe("z-1");
  });

  it("returns inZone=false when point is outside all zones", () => {
    const zones = [makeZone("z-1", "Kenesis HQ", 12.97, 77.59, 500)];
    // Point far away
    const result = isWithinOfficeZone(13.08, 80.27, zones);

    expect(result.inZone).toBe(false);
    expect(result.zoneName).toBeUndefined();
  });

  it("returns first matching zone", () => {
    const zones = [
      makeZone("z-1", "Zone A", 12.97, 77.59, 1000),
      makeZone("z-2", "Zone B", 12.97, 77.59, 500),
    ];
    const result = isWithinOfficeZone(12.97, 77.59, zones);

    expect(result.inZone).toBe(true);
    expect(result.zoneName).toBe("Zone A"); // first match
  });

  it("handles empty zones array", () => {
    const result = isWithinOfficeZone(12.97, 77.59, []);
    expect(result.inZone).toBe(false);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceProofStore } from "./workspaceProofStore";
import { useAuthStore } from "./authStore";
import type { WorkspaceLocation, OfficeZone } from "@/types";

// Mock PocketBase (needed by authStore)
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: { isValid: false, record: null, token: "", clear: vi.fn(), save: vi.fn() },
    collection: vi.fn(() => ({
      create: vi.fn(async () => ({ id: "mock" })),
    })),
  },
}));

// Mock geolocation module
vi.mock("@/lib/geolocation", () => ({
  getCurrentLocation: vi.fn(),
  matchOrCreateLocation: vi.fn(),
}));

// Mock photoCapture module
vi.mock("@/lib/photoCapture", () => ({
  computePhotoHash: vi.fn(() => "abcd1234"),
  validateExifTimestamp: vi.fn(),
  parseExifTimestamp: vi.fn(),
  captureWebcamFrame: vi.fn(),
}));

// Mock workspaceProof module
vi.mock("@/lib/workspaceProof", () => ({
  createWorkspaceProof: vi.fn(
    (id, sessionId, userId, type, photoPath, photoHash, lat, lng, accuracy, locationId, exifTimestamp) => ({
      id,
      sessionId,
      userId,
      type,
      photoPath,
      photoHash,
      lat,
      lng,
      accuracy,
      locationId,
      aiVerified: "pending",
      aiReason: null,
      exifTimestamp,
      createdAt: Math.floor(Date.now() / 1000),
    }),
  ),
}));

import { getCurrentLocation, matchOrCreateLocation } from "@/lib/geolocation";
import { validateExifTimestamp, parseExifTimestamp, computePhotoHash } from "@/lib/photoCapture";

const mockGetCurrentLocation = vi.mocked(getCurrentLocation);
const mockMatchOrCreate = vi.mocked(matchOrCreateLocation);
const mockValidateExif = vi.mocked(validateExifTimestamp);
const mockParseExif = vi.mocked(parseExifTimestamp);
const mockComputeHash = vi.mocked(computePhotoHash);

const now = Math.floor(Date.now() / 1000);

function makeBlob(content = "fake-photo-data"): Blob {
  return new Blob([content], { type: "image/jpeg" });
}

function makeLocation(id: string, name: string, lat: number, lng: number): WorkspaceLocation {
  return {
    id,
    userId: "user-1",
    name,
    lat,
    lng,
    radiusMeters: 200,
    isOfficeZone: false,
    createdAt: now,
  };
}

function makeOfficeZone(id: string, name: string, lat: number, lng: number): OfficeZone {
  return {
    id,
    teamId: "team-1",
    name,
    lat,
    lng,
    radiusMeters: 500,
    createdBy: "user-1",
    createdAt: now,
  };
}

describe("workspaceProofStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceProofStore.setState({
      currentProof: null,
      sessionProofs: [],
      savedLocations: [],
      officeZones: [],
      currentLocation: null,
      locationMatch: null,
      loading: false,
      error: null,
    });
    useAuthStore.setState({
      user: { id: "user-1", name: "Alice", email: "alice@test.com", role: null, avatarColor: "#000" },
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it("starts with empty state", () => {
    const state = useWorkspaceProofStore.getState();
    expect(state.currentProof).toBeNull();
    expect(state.sessionProofs).toEqual([]);
    expect(state.savedLocations).toEqual([]);
    expect(state.officeZones).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe("captureProof", () => {
    it("creates a checkin proof and adds to session proofs", async () => {
      const blob = makeBlob();
      const proof = await useWorkspaceProofStore
        .getState()
        .captureProof("session-1", "checkin", blob, null, "loc-1");

      expect(proof.sessionId).toBe("session-1");
      expect(proof.type).toBe("checkin");
      expect(proof.userId).toBe("user-1");
      expect(proof.locationId).toBe("loc-1");
      expect(proof.photoHash).toBe("abcd1234");

      const state = useWorkspaceProofStore.getState();
      expect(state.currentProof).toEqual(proof);
      expect(state.sessionProofs).toHaveLength(1);
      expect(state.loading).toBe(false);
    });

    it("creates a checkout proof", async () => {
      const blob = makeBlob();
      const proof = await useWorkspaceProofStore
        .getState()
        .captureProof("session-1", "checkout", blob, null, null);

      expect(proof.type).toBe("checkout");
      expect(proof.sessionId).toBe("session-1");
    });

    it("includes current location in proof when available", async () => {
      useWorkspaceProofStore.setState({
        currentLocation: { lat: 12.97, lng: 77.59, accuracy: 50, lowAccuracy: false },
      });

      const blob = makeBlob();
      const proof = await useWorkspaceProofStore
        .getState()
        .captureProof("session-1", "checkin", blob, null, null);

      expect(proof.lat).toBe(12.97);
      expect(proof.lng).toBe(77.59);
    });

    it("throws when not authenticated", async () => {
      useAuthStore.setState({ user: null, isAuthenticated: false });
      const blob = makeBlob();

      await expect(
        useWorkspaceProofStore.getState().captureProof("s-1", "checkin", blob, null, null),
      ).rejects.toThrow("Not authenticated");
    });

    it("sets error on failure", async () => {
      mockComputeHash.mockImplementationOnce(() => {
        throw new Error("Hash failed");
      });

      const blob = makeBlob();
      await expect(
        useWorkspaceProofStore.getState().captureProof("s-1", "checkin", blob, null, null),
      ).rejects.toThrow("Hash failed");

      expect(useWorkspaceProofStore.getState().error).toBe("Hash failed");
      expect(useWorkspaceProofStore.getState().loading).toBe(false);
    });

    it("passes exifTimestamp to proof", async () => {
      const blob = makeBlob();
      const proof = await useWorkspaceProofStore
        .getState()
        .captureProof("session-1", "checkin", blob, 1700000000, "loc-1");

      expect(proof.exifTimestamp).toBe(1700000000);
    });
  });

  describe("uploadPhoto", () => {
    it("validates EXIF and returns hash for fresh photo", async () => {
      mockParseExif.mockReturnValueOnce(now - 60);
      mockValidateExif.mockReturnValueOnce({
        accepted: true,
        reason: "fresh",
        unverifiedTimestamp: false,
        exifTimestamp: now - 60,
      });

      const file = new File(["photo-data"], "photo.jpg", { type: "image/jpeg" });
      const result = await useWorkspaceProofStore.getState().uploadPhoto(file);

      expect(result.hash).toBe("abcd1234");
      expect(result.exifResult.accepted).toBe(true);
      expect(result.exifResult.reason).toBe("fresh");
    });

    it("returns rejected result for stale EXIF", async () => {
      mockParseExif.mockReturnValueOnce(now - 600);
      mockValidateExif.mockReturnValueOnce({
        accepted: false,
        reason: "stale",
        unverifiedTimestamp: false,
        exifTimestamp: now - 600,
      });

      const file = new File(["old-photo"], "old.jpg", { type: "image/jpeg" });
      const result = await useWorkspaceProofStore.getState().uploadPhoto(file);

      expect(result.exifResult.accepted).toBe(false);
      expect(result.exifResult.reason).toBe("stale");
    });

    it("accepts photo with no EXIF data", async () => {
      mockParseExif.mockReturnValueOnce(null);
      mockValidateExif.mockReturnValueOnce({
        accepted: true,
        reason: "no_exif",
        unverifiedTimestamp: true,
        exifTimestamp: null,
      });

      const file = new File(["no-exif"], "webcam.jpg", { type: "image/jpeg" });
      const result = await useWorkspaceProofStore.getState().uploadPhoto(file);

      expect(result.exifResult.accepted).toBe(true);
      expect(result.exifResult.reason).toBe("no_exif");
    });
  });

  describe("getLocation", () => {
    it("captures current location and auto-matches", async () => {
      mockGetCurrentLocation.mockResolvedValueOnce({
        lat: 12.97,
        lng: 77.59,
        accuracy: 50,
        lowAccuracy: false,
      });
      mockMatchOrCreate.mockReturnValueOnce({
        matched: true,
        locationId: "loc-1",
        locationName: "Kenesis HQ",
        isOfficeZone: true,
        promptForNewName: false,
      });

      const result = await useWorkspaceProofStore.getState().getLocation();

      expect(result).toEqual({
        lat: 12.97,
        lng: 77.59,
        accuracy: 50,
        lowAccuracy: false,
      });

      const state = useWorkspaceProofStore.getState();
      expect(state.currentLocation).toEqual(result);
      expect(state.locationMatch?.matched).toBe(true);
      expect(state.locationMatch?.locationName).toBe("Kenesis HQ");
    });

    it("returns null when geolocation unavailable", async () => {
      mockGetCurrentLocation.mockResolvedValueOnce(null);

      const result = await useWorkspaceProofStore.getState().getLocation();

      expect(result).toBeNull();
      expect(useWorkspaceProofStore.getState().currentLocation).toBeNull();
    });
  });

  describe("matchLocation", () => {
    it("matches against saved locations and office zones", () => {
      const loc = makeLocation("loc-1", "Home Office", 12.97, 77.59);
      useWorkspaceProofStore.setState({ savedLocations: [loc] });

      mockMatchOrCreate.mockReturnValueOnce({
        matched: true,
        locationId: "loc-1",
        locationName: "Home Office",
        isOfficeZone: false,
        promptForNewName: false,
      });

      const result = useWorkspaceProofStore.getState().matchLocation(12.97, 77.59);

      expect(result.matched).toBe(true);
      expect(result.locationName).toBe("Home Office");
      expect(useWorkspaceProofStore.getState().locationMatch).toEqual(result);
    });
  });

  describe("saveLocation", () => {
    it("adds a new location to saved locations", () => {
      const loc = makeLocation("loc-new", "Coffee Shop", 13.0, 77.6);
      useWorkspaceProofStore.getState().saveLocation(loc);

      expect(useWorkspaceProofStore.getState().savedLocations).toHaveLength(1);
      expect(useWorkspaceProofStore.getState().savedLocations[0].name).toBe("Coffee Shop");
    });
  });

  describe("setters", () => {
    it("setSavedLocations replaces locations", () => {
      const locs = [makeLocation("l-1", "A", 0, 0), makeLocation("l-2", "B", 1, 1)];
      useWorkspaceProofStore.getState().setSavedLocations(locs);
      expect(useWorkspaceProofStore.getState().savedLocations).toHaveLength(2);
    });

    it("setOfficeZones replaces zones", () => {
      const zones = [makeOfficeZone("z-1", "HQ", 12.97, 77.59)];
      useWorkspaceProofStore.getState().setOfficeZones(zones);
      expect(useWorkspaceProofStore.getState().officeZones).toHaveLength(1);
    });

    it("setSessionProofs replaces proofs", () => {
      useWorkspaceProofStore.getState().setSessionProofs([
        {
          id: "p-1",
          sessionId: "s-1",
          userId: "user-1",
          type: "checkin",
          photoPath: "path.jpg",
          photoHash: "hash",
          lat: null,
          lng: null,
          accuracy: null,
          locationId: null,
          aiVerified: "pending",
          aiReason: null,
          exifTimestamp: null,
          createdAt: now,
        },
      ]);
      expect(useWorkspaceProofStore.getState().sessionProofs).toHaveLength(1);
    });
  });

  describe("clearCurrentProof", () => {
    it("resets current proof, location, and match", () => {
      useWorkspaceProofStore.setState({
        currentProof: {
          id: "p-1",
          sessionId: "s-1",
          userId: "user-1",
          type: "checkin",
          photoPath: "path.jpg",
          photoHash: "hash",
          lat: 12.97,
          lng: 77.59,
          accuracy: 50,
          locationId: "loc-1",
          aiVerified: "pending",
          aiReason: null,
          exifTimestamp: null,
          createdAt: now,
        },
        currentLocation: { lat: 12.97, lng: 77.59, accuracy: 50, lowAccuracy: false },
        locationMatch: {
          matched: true,
          locationId: "loc-1",
          locationName: "HQ",
          isOfficeZone: true,
          promptForNewName: false,
        },
      });

      useWorkspaceProofStore.getState().clearCurrentProof();

      const state = useWorkspaceProofStore.getState();
      expect(state.currentProof).toBeNull();
      expect(state.currentLocation).toBeNull();
      expect(state.locationMatch).toBeNull();
    });
  });

  describe("clearError", () => {
    it("clears the error message", () => {
      useWorkspaceProofStore.setState({ error: "Something went wrong" });
      useWorkspaceProofStore.getState().clearError();
      expect(useWorkspaceProofStore.getState().error).toBeNull();
    });
  });
});

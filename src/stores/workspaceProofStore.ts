/**
 * Workspace proof Zustand store for PACE v2 Team Ops.
 *
 * Holds current proof state, saved locations, and office zones.
 * Actions wire to lib functions from workspaceProof, geolocation,
 * photoCapture, and officeZones modules.
 *
 * Requirements: Task 18.12
 */

import { create } from "zustand";
import type {
  WorkspaceProof,
  WorkspaceLocation,
  OfficeZone,
} from "@/types";
import { createWorkspaceProof } from "@/lib/workspaceProof";
import {
  getCurrentLocation,
  matchOrCreateLocation,
  type GeoLocationResult,
  type LocationMatchResult,
} from "@/lib/geolocation";
import {
  computePhotoHash,
  validateExifTimestamp,
  parseExifTimestamp,
  type ExifValidationResult,
} from "@/lib/photoCapture";
import { useAuthStore } from "@/stores/authStore";

interface WorkspaceProofState {
  /** Current proof being captured (null when idle) */
  currentProof: WorkspaceProof | null;
  /** All proofs for the current session */
  sessionProofs: WorkspaceProof[];
  /** User's saved workspace locations */
  savedLocations: WorkspaceLocation[];
  /** Team office zones */
  officeZones: OfficeZone[];
  /** Current geolocation result (null if not yet captured) */
  currentLocation: GeoLocationResult | null;
  /** Current location match result */
  locationMatch: LocationMatchResult | null;
  /** Loading state for async operations */
  loading: boolean;
  /** Error message from last operation */
  error: string | null;
}

interface WorkspaceProofActions {
  /**
   * Capture a complete workspace proof: photo + location → proof record.
   * Used for both check-in and check-out flows.
   */
  captureProof: (
    sessionId: string,
    type: "checkin" | "checkout",
    photoBlob: Blob,
    exifTimestamp: number | null,
    locationId: string | null,
  ) => Promise<WorkspaceProof>;

  /**
   * Process an uploaded photo file: validate EXIF, compute hash.
   * Returns validation result and hash for use in captureProof.
   */
  uploadPhoto: (
    file: File,
  ) => Promise<{ hash: string; exifResult: ExifValidationResult }>;

  /**
   * Get the current device location via geolocation API.
   */
  getLocation: () => Promise<GeoLocationResult | null>;

  /**
   * Match current location against saved locations and office zones.
   */
  matchLocation: (
    lat: number,
    lng: number,
  ) => LocationMatchResult;

  /**
   * Save a new workspace location for future auto-tagging.
   */
  saveLocation: (location: WorkspaceLocation) => void;

  /** Set saved locations (e.g. loaded from DB) */
  setSavedLocations: (locations: WorkspaceLocation[]) => void;

  /** Set office zones (e.g. loaded from DB) */
  setOfficeZones: (zones: OfficeZone[]) => void;

  /** Set session proofs (e.g. loaded from DB) */
  setSessionProofs: (proofs: WorkspaceProof[]) => void;

  /** Clear current proof state */
  clearCurrentProof: () => void;

  /** Clear error */
  clearError: () => void;
}

let proofCounter = 0;

function generateProofId(): string {
  proofCounter += 1;
  return `proof-${Date.now()}-${proofCounter}`;
}

export const useWorkspaceProofStore = create<
  WorkspaceProofState & WorkspaceProofActions
>((set, get) => ({
  currentProof: null,
  sessionProofs: [],
  savedLocations: [],
  officeZones: [],
  currentLocation: null,
  locationMatch: null,
  loading: false,
  error: null,

  captureProof: async (sessionId, type, photoBlob, exifTimestamp, locationId) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error("Not authenticated");

    set({ loading: true, error: null });
    try {
      // Compute photo hash from blob data
      const arrayBuffer = await photoBlob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      const photoHash = computePhotoHash(data);

      // Use a local file path placeholder (in real app, saved to Tauri app data dir)
      const photoPath = `proofs/${sessionId}-${type}-${Date.now()}.jpg`;

      // Get location info from current state
      const { currentLocation } = get();
      const lat = currentLocation?.lat ?? null;
      const lng = currentLocation?.lng ?? null;
      const accuracy = currentLocation?.accuracy ?? null;

      const proof = createWorkspaceProof(
        generateProofId(),
        sessionId,
        user.id,
        type,
        photoPath,
        photoHash,
        lat,
        lng,
        accuracy,
        locationId,
        exifTimestamp,
      );

      set((state) => ({
        currentProof: proof,
        sessionProofs: [...state.sessionProofs, proof],
        loading: false,
      }));

      return proof;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loading: false, error: message });
      throw error;
    }
  },

  uploadPhoto: async (file) => {
    set({ loading: true, error: null });
    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      // Parse EXIF timestamp from file
      const exifTimestamp = parseExifTimestamp(data);

      // Validate EXIF freshness
      const nowSeconds = Math.floor(Date.now() / 1000);
      const exifResult = validateExifTimestamp(exifTimestamp, nowSeconds);

      // Compute hash
      const hash = computePhotoHash(data);

      set({ loading: false });
      return { hash, exifResult };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loading: false, error: message });
      throw error;
    }
  },

  getLocation: async () => {
    set({ loading: true, error: null });
    try {
      const location = await getCurrentLocation();
      set({ currentLocation: location, loading: false });

      // Auto-match if we got a location
      if (location) {
        const { savedLocations, officeZones } = get();
        const match = matchOrCreateLocation(
          location.lat,
          location.lng,
          savedLocations,
          officeZones,
        );
        set({ locationMatch: match });
      }

      return location;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ loading: false, error: message });
      return null;
    }
  },

  matchLocation: (lat, lng) => {
    const { savedLocations, officeZones } = get();
    const match = matchOrCreateLocation(lat, lng, savedLocations, officeZones);
    set({ locationMatch: match });
    return match;
  },

  saveLocation: (location) => {
    set((state) => ({
      savedLocations: [...state.savedLocations, location],
    }));
  },

  setSavedLocations: (locations) => set({ savedLocations: locations }),
  setOfficeZones: (zones) => set({ officeZones: zones }),
  setSessionProofs: (proofs) => set({ sessionProofs: proofs }),

  clearCurrentProof: () =>
    set({ currentProof: null, currentLocation: null, locationMatch: null }),

  clearError: () => set({ error: null }),
}));

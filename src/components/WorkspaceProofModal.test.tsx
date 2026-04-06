import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkspaceProofModal from "@/components/WorkspaceProofModal";
import { useWorkspaceProofStore } from "@/stores/workspaceProofStore";
import { useAuthStore } from "@/stores/authStore";

// Mock PocketBase
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: { isValid: false, record: null, token: "", clear: vi.fn(), save: vi.fn() },
    collection: vi.fn(() => ({ create: vi.fn() })),
  },
}));

// Mock geolocation module
vi.mock("@/lib/geolocation", () => ({
  getCurrentLocation: vi.fn().mockResolvedValue(null),
  matchOrCreateLocation: vi.fn().mockReturnValue({
    matched: false,
    locationId: null,
    locationName: null,
    isOfficeZone: false,
    promptForNewName: true,
  }),
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

// Mock navigator.mediaDevices to prevent actual camera access
const mockGetUserMedia = vi.fn().mockRejectedValue(new Error("No camera in test"));
Object.defineProperty(navigator, "mediaDevices", {
  value: { getUserMedia: mockGetUserMedia },
  writable: true,
});

describe("WorkspaceProofModal", () => {
  const onComplete = vi.fn();
  const onCancel = vi.fn();

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

  it("renders check-in modal with correct title", () => {
    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Check-in Proof")).toBeDefined();
    expect(screen.getByText("Capture & Start")).toBeDefined();
  });

  it("renders check-out modal with correct title", () => {
    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkout"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Check-out Proof")).toBeDefined();
    expect(screen.getByText("Capture & End")).toBeDefined();
  });

  it("shows webcam and upload mode toggle buttons", () => {
    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Webcam")).toBeDefined();
    expect(screen.getByText("Upload")).toBeDefined();
  });

  it("calls onCancel when Cancel button is clicked", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    // There are two cancel buttons (X icon and text button), click the text one
    const cancelButtons = screen.getAllByText("Cancel");
    await user.click(cancelButtons[0]);

    expect(onCancel).toHaveBeenCalled();
  });

  it("switches to upload mode when Upload button is clicked", async () => {
    const user = userEvent.setup();

    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByText("Upload"));

    // Should show the drop zone
    expect(screen.getByText("Drop a photo here")).toBeDefined();
  });

  it("shows location section", () => {
    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Location")).toBeDefined();
  });

  it("shows location unavailable message when no geolocation", async () => {
    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    // Wait for location fetch to complete (returns null)
    await vi.waitFor(() => {
      expect(
        screen.getByText("Location unavailable — select from saved locations:"),
      ).toBeDefined();
    });
  });

  it("shows matched location when available", async () => {
    useWorkspaceProofStore.setState({
      currentLocation: { lat: 12.97, lng: 77.59, accuracy: 50, lowAccuracy: false },
      locationMatch: {
        matched: true,
        locationId: "loc-1",
        locationName: "Kenesis HQ",
        isOfficeZone: true,
        promptForNewName: false,
      },
    });

    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Kenesis HQ")).toBeDefined();
    expect(screen.getByText("(Office Zone)")).toBeDefined();
  });

  it("shows new location prompt when no match", async () => {
    useWorkspaceProofStore.setState({
      currentLocation: { lat: 13.0, lng: 78.0, accuracy: 50, lowAccuracy: false },
      locationMatch: {
        matched: false,
        locationId: null,
        locationName: null,
        isOfficeZone: false,
        promptForNewName: true,
      },
    });

    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("New location detected")).toBeDefined();
    expect(screen.getByLabelText("New location name")).toBeDefined();
  });

  it("submit button is disabled when no photo captured", () => {
    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    const submitBtn = screen.getByText("Capture & Start");
    expect(submitBtn.closest("button")?.disabled).toBe(true);
  });

  it("displays error from store", async () => {
    render(
      <WorkspaceProofModal
        sessionId="session-1"
        type="checkin"
        onComplete={onComplete}
        onCancel={onCancel}
      />,
    );

    // Wait for location fetch to settle, then set error
    await vi.waitFor(() => {
      expect(useWorkspaceProofStore.getState().loading).toBe(false);
    });

    // Simulate an error occurring after mount
    useWorkspaceProofStore.setState({ error: "Camera failed" });

    await vi.waitFor(() => {
      expect(screen.getByText("Camera failed")).toBeDefined();
    });
  });
});

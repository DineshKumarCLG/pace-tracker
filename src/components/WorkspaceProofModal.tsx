/**
 * Workspace Proof Modal — reusable for check-in and check-out flows.
 *
 * Layout: webcam preview (or file drop zone) + location display.
 * "Capture & Start" / "Capture & End" button creates the proof record.
 *
 * Requirements: Task 18.7, 18.8, 18.12
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Camera,
  Upload,
  MapPin,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useWorkspaceProofStore } from "@/stores/workspaceProofStore";
import { captureWebcamFrame } from "@/lib/photoCapture";
import { cn } from "@/lib/utils";
import type { WorkspaceProof, WorkspaceLocation } from "@/types";

interface WorkspaceProofModalProps {
  sessionId: string;
  type: "checkin" | "checkout";
  onComplete: (proof: WorkspaceProof) => void;
  onCancel: () => void;
}

type CaptureMode = "webcam" | "upload";

export default function WorkspaceProofModal({
  sessionId,
  type,
  onComplete,
  onCancel,
}: WorkspaceProofModalProps) {
  const [mode, setMode] = useState<CaptureMode>("webcam");
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [exifTimestamp, setExifTimestamp] = useState<number | null>(null);
  const [exifRejected, setExifRejected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");

  const {
    currentLocation,
    locationMatch,
    savedLocations,
    loading,
    error,
    getLocation,
    uploadPhoto,
    captureProof,
    matchLocation,
    saveLocation,
    clearError,
  } = useWorkspaceProofStore();

  // Fetch location on mount
  useEffect(() => {
    getLocation();
  }, [getLocation]);

  const selectedLocationId = locationMatch?.locationId ?? null;

  async function handleSubmit() {
    if (!capturedBlob) return;

    setSubmitting(true);
    try {
      // If user named a new location, save it first
      let locationId = selectedLocationId;
      if (locationMatch?.promptForNewName && newLocationName.trim()) {
        const newLoc: WorkspaceLocation = {
          id: `loc-${Date.now()}`,
          userId: "", // will be set by the store/DB layer
          name: newLocationName.trim(),
          lat: currentLocation?.lat ?? 0,
          lng: currentLocation?.lng ?? 0,
          radiusMeters: 200,
          isOfficeZone: false,
          createdAt: Math.floor(Date.now() / 1000),
        };
        saveLocation(newLoc);
        locationId = newLoc.id;
      }

      const proof = await captureProof(
        sessionId,
        type,
        capturedBlob,
        exifTimestamp,
        locationId,
      );
      onComplete(proof);
    } catch {
      // Error is set in the store
    } finally {
      setSubmitting(false);
    }
  }

  const actionLabel =
    type === "checkin" ? "Capture & Start" : "Capture & End";

  const canSubmit = capturedBlob !== null && !exifRejected && !submitting;

  return (
    <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          {type === "checkin" ? "Check-in Proof" : "Check-out Proof"}
        </h2>
        <button
          onClick={onCancel}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setMode("webcam");
            setCapturedBlob(null);
            setCapturedPreview(null);
            setExifRejected(false);
            clearError();
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "webcam"
              ? "bg-primary text-primary-foreground"
              : "border border-input bg-background hover:bg-accent",
          )}
        >
          <Camera className="h-3.5 w-3.5" />
          Webcam
        </button>
        <button
          onClick={() => {
            setMode("upload");
            setCapturedBlob(null);
            setCapturedPreview(null);
            setExifRejected(false);
            clearError();
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "upload"
              ? "bg-primary text-primary-foreground"
              : "border border-input bg-background hover:bg-accent",
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          Upload
        </button>
      </div>

      {/* Photo capture area */}
      <div className="min-h-[200px]">
        {mode === "webcam" ? (
          <WebcamCapture
            onCapture={(blob, preview) => {
              setCapturedBlob(blob);
              setCapturedPreview(preview);
              setExifTimestamp(null);
              setExifRejected(false);
            }}
            capturedPreview={capturedPreview}
          />
        ) : (
          <FileDropZone
            onFileAccepted={(blob, preview, exifTs) => {
              setCapturedBlob(blob);
              setCapturedPreview(preview);
              setExifTimestamp(exifTs);
              setExifRejected(false);
            }}
            onExifRejected={() => {
              setCapturedBlob(null);
              setCapturedPreview(null);
              setExifRejected(true);
            }}
            capturedPreview={capturedPreview}
            uploadPhoto={uploadPhoto}
          />
        )}
      </div>

      {exifRejected && (
        <div
          className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Photo is older than 5 minutes. Please take a fresh photo.
        </div>
      )}

      {/* Location display */}
      <LocationDisplay
        currentLocation={currentLocation}
        locationMatch={locationMatch}
        loading={loading}
        newLocationName={newLocationName}
        onNewLocationNameChange={setNewLocationName}
        savedLocations={savedLocations}
        onSelectLocation={(locId) => {
          const loc = savedLocations.find((l) => l.id === locId);
          if (loc) {
            matchLocation(loc.lat, loc.lng);
          }
        }}
      />

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            "flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
            "hover:bg-primary/90 disabled:opacity-50",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          )}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Capturing…
            </span>
          ) : (
            actionLabel
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={submitting}
          className={cn(
            "rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground",
            "hover:bg-accent disabled:opacity-50",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ─── Webcam Preview Component ─── */

interface WebcamCaptureProps {
  onCapture: (blob: Blob, previewUrl: string) => void;
  capturedPreview: string | null;
}

function WebcamCapture({ onCapture, capturedPreview }: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      setCameraError(
        "Camera unavailable. Please use the Upload option instead.",
      );
    }
  }, []);

  useEffect(() => {
    if (!capturedPreview) {
      startCamera();
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [capturedPreview, startCamera]);

  async function handleCapture() {
    if (!videoRef.current) return;
    const blob = await captureWebcamFrame(videoRef.current);
    if (blob) {
      const url = URL.createObjectURL(blob);
      onCapture(blob, url);
      // Stop camera after capture
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    }
  }

  if (capturedPreview) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-border">
        <img
          src={capturedPreview}
          alt="Captured workspace"
          className="w-full h-[200px] object-cover"
        />
        <div className="absolute top-2 right-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        </div>
      </div>
    );
  }

  if (cameraError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 p-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm text-muted-foreground">{cameraError}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative rounded-lg overflow-hidden border border-border bg-black">
        <video
          ref={videoRef}
          className="w-full h-[200px] object-cover"
          muted
          playsInline
          aria-label="Webcam preview"
        />
        {!cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </div>
      <button
        onClick={handleCapture}
        disabled={!cameraReady}
        className={cn(
          "w-full rounded-md border border-input bg-background px-4 py-2 text-sm font-medium",
          "hover:bg-accent disabled:opacity-50 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        )}
      >
        <span className="flex items-center justify-center gap-2">
          <Camera className="h-4 w-4" />
          Take Photo
        </span>
      </button>
    </div>
  );
}

/* ─── File Drop Zone Component ─── */

interface FileDropZoneProps {
  onFileAccepted: (
    blob: Blob,
    previewUrl: string,
    exifTimestamp: number | null,
  ) => void;
  onExifRejected: () => void;
  capturedPreview: string | null;
  uploadPhoto: (
    file: File,
  ) => Promise<{ hash: string; exifResult: { accepted: boolean; reason: string; exifTimestamp: number | null } }>;
}

function FileDropZone({
  onFileAccepted,
  onExifRejected,
  capturedPreview,
  uploadPhoto,
}: FileDropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function processFile(file: File) {
    if (!file.type.startsWith("image/")) return;

    setProcessing(true);
    try {
      const result = await uploadPhoto(file);

      if (!result.exifResult.accepted) {
        onExifRejected();
        return;
      }

      const url = URL.createObjectURL(file);
      onFileAccepted(file, url, result.exifResult.exifTimestamp);
    } catch {
      // Error handled by store
    } finally {
      setProcessing(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  if (capturedPreview) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-border">
        <img
          src={capturedPreview}
          alt="Uploaded workspace"
          className="w-full h-[200px] object-cover"
        />
        <div className="absolute top-2 right-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      aria-label="Drop a photo here or click to upload"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors",
        dragging
          ? "border-primary bg-primary/5"
          : "border-border bg-muted/50 hover:border-primary/50",
      )}
    >
      {processing ? (
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      ) : (
        <>
          <Upload className="h-8 w-8 text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">
              Drop a photo here
            </p>
            <p className="text-xs text-muted-foreground">
              or click to select — JPEG/PNG, taken within 5 minutes
            </p>
          </div>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={handleFileSelect}
        aria-hidden="true"
      />
    </div>
  );
}

/* ─── Location Display Component ─── */

interface LocationDisplayProps {
  currentLocation: { lat: number; lng: number; accuracy: number; lowAccuracy: boolean } | null;
  locationMatch: {
    matched: boolean;
    locationId: string | null;
    locationName: string | null;
    isOfficeZone: boolean;
    promptForNewName: boolean;
  } | null;
  loading: boolean;
  newLocationName: string;
  onNewLocationNameChange: (name: string) => void;
  savedLocations: WorkspaceLocation[];
  onSelectLocation: (locationId: string) => void;
}

function LocationDisplay({
  currentLocation,
  locationMatch,
  loading,
  newLocationName,
  onNewLocationNameChange,
  savedLocations,
  onSelectLocation,
}: LocationDisplayProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <MapPin className="h-4 w-4 text-primary" />
        Location
      </div>

      {loading && !currentLocation && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Detecting location…
        </div>
      )}

      {currentLocation && locationMatch?.matched && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-foreground">
            {locationMatch.locationName}
            {locationMatch.isOfficeZone && (
              <span className="ml-1 text-xs text-muted-foreground">
                (Office Zone)
              </span>
            )}
          </span>
        </div>
      )}

      {currentLocation && locationMatch && !locationMatch.matched && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            New location detected
          </div>
          <input
            type="text"
            placeholder="Name this workspace…"
            value={newLocationName}
            onChange={(e) => onNewLocationNameChange(e.target.value)}
            className={cn(
              "rounded-md border border-input bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
            aria-label="New location name"
          />
        </div>
      )}

      {currentLocation && currentLocation.lowAccuracy && (
        <div className="flex items-center gap-2 text-xs text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Low accuracy ({Math.round(currentLocation.accuracy)}m) — location may be imprecise
        </div>
      )}

      {!currentLocation && !loading && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Location unavailable — select from saved locations:
          </p>
          {savedLocations.length > 0 ? (
            <select
              onChange={(e) => onSelectLocation(e.target.value)}
              defaultValue=""
              className={cn(
                "rounded-md border border-input bg-background px-3 py-2 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
              aria-label="Select saved location"
            >
              <option value="" disabled>
                Choose a location…
              </option>
              {savedLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-muted-foreground">
              No saved locations yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

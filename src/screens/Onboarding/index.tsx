/**
 * Onboarding Screen — Multi-step flow (no sidebar)
 *
 * Step 1: Welcome — PACE logo + tagline → "Get started"
 * Step 2: Profile setup — Avatar color picker, role/title field → "Continue"
 * Step 3: Team setup — Create or join a team (first user) / Join team (subsequent)
 * Step 4: First project — Project name → "Start tracking"
 *
 * On completion: navigate to Founder Dashboard with session auto-started.
 * Requirements: v1 Req 18.1, 18.2, 18.3 (enhanced)
 */

import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import { pb } from "@/lib/pocketbase";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

type OnboardingStep = 1 | 2 | 3 | 4;

const AVATAR_COLORS = [
  "#6e6af6", // indigo
  "#d97706", // amber
  "#3b9e6f", // emerald
  "#c45e8a", // pink
  "#2563eb", // blue
  "#dc2626", // red
  "#7c3aed", // violet
  "#0891b2", // cyan
];

export default function OnboardingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [step, setStep] = useState<OnboardingStep>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Step 2 — Profile */
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor ?? "#6e6af6");
  const [role, setRole] = useState(user?.role ?? "");

  /* Step 3 — Team */
  const [teamMode, setTeamMode] = useState<"create" | "join">("create");
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [generatedInviteCode, setGeneratedInviteCode] = useState<string | null>(null);

  /* Step 4 — Project */
  const [projectName, setProjectName] = useState("");

  function clearError() {
    setError(null);
  }

  /* ── Step handlers ── */

  function handleGetStarted() {
    setStep(2);
  }

  async function handleProfileContinue() {
    if (!role.trim()) {
      setError("Enter your role or title");
      return;
    }
    clearError();
    setLoading(true);
    try {
      // Update user profile in PocketBase
      if (user?.id) {
        await pb.collection("users").update(user.id, {
          avatarColor,
          role: role.trim(),
        });
        // Update local auth store
        useAuthStore.setState({
          user: { ...user, avatarColor, role: role.trim() },
        });
      }
      setStep(3);
    } catch {
      setError("Could not save profile. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTeamContinue() {
    clearError();
    setLoading(true);
    try {
      if (teamMode === "create") {
        if (!teamName.trim()) {
          setError("Enter a team name");
          setLoading(false);
          return;
        }
        // Generate an 8-char alphanumeric invite code
        const code = generateInviteCode();
        // Create team in PocketBase
        const team = await pb.collection("teams").create({
          name: teamName.trim(),
          inviteCode: code,
          createdBy: user?.id,
        });
        // Add creator as team member
        await pb.collection("team_members").create({
          teamId: team.id,
          userId: user?.id,
        });
        setGeneratedInviteCode(code);
      } else {
        if (!inviteCode.trim()) {
          setError("Paste the invite code");
          setLoading(false);
          return;
        }
        // Find team by invite code
        const teams = await pb.collection("teams").getList(1, 1, {
          filter: `inviteCode = "${inviteCode.trim()}"`,
        });
        if (teams.items.length === 0) {
          setError("Invalid invite code. Check with your team and try again.");
          setLoading(false);
          return;
        }
        // Join the team
        await pb.collection("team_members").create({
          teamId: teams.items[0].id,
          userId: user?.id,
        });
      }
      setStep(4);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("already")) {
        // Already a member — just proceed
        setStep(4);
      } else {
        setError("Could not set up team. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleStartTracking() {
    if (!projectName.trim()) {
      setError("Enter a project name");
      return;
    }
    clearError();
    setLoading(true);
    try {
      // Create project in PocketBase
      await pb.collection("projects").create({
        name: projectName.trim(),
        color: "#6e6af6",
        createdBy: user?.id,
      });
      // Navigate to dashboard (founder dashboard is the v2 landing)
      router.navigate({ to: "/" });
    } catch {
      setError("Could not create project. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  /* ── Progress indicator ── */
  const totalSteps = 4;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full opacity-15 blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, hsl(235 70% 60%) 0%, transparent 70%)",
        }}
      />

      {/* Glass card */}
      <div className="glass-elevated noise relative z-10 w-full max-w-[440px] rounded-2xl p-8 animate-scale-in">
        {/* Progress dots */}
        {step > 1 && (
          <div className="mb-6 flex items-center justify-center gap-2">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i + 1 <= step
                    ? "w-6 bg-primary"
                    : "w-1.5 bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-[12px] text-destructive">
            {error}
          </div>
        )}

        {/* Step 1 — Welcome */}
        {step === 1 && <WelcomeStep onContinue={handleGetStarted} />}

        {/* Step 2 — Profile */}
        {step === 2 && (
          <ProfileStep
            avatarColor={avatarColor}
            onColorChange={setAvatarColor}
            role={role}
            onRoleChange={setRole}
            onContinue={handleProfileContinue}
            loading={loading}
            userName={user?.name ?? ""}
          />
        )}

        {/* Step 3 — Team */}
        {step === 3 && (
          <TeamStep
            teamMode={teamMode}
            onModeChange={(m) => {
              setTeamMode(m);
              clearError();
            }}
            teamName={teamName}
            onTeamNameChange={setTeamName}
            inviteCode={inviteCode}
            onInviteCodeChange={setInviteCode}
            generatedInviteCode={generatedInviteCode}
            onContinue={handleTeamContinue}
            loading={loading}
          />
        )}

        {/* Step 4 — First project */}
        {step === 4 && (
          <ProjectStep
            projectName={projectName}
            onProjectNameChange={setProjectName}
            onContinue={handleStartTracking}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Step Components
   ═══════════════════════════════════════════════════════════════ */

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* PACE logo */}
      <div
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl text-xl font-black tracking-tight"
        style={{
          background:
            "linear-gradient(135deg, hsl(235 70% 60%) 0%, hsl(250 65% 50%) 100%)",
          color: "#fff",
          boxShadow:
            "0 0 0 0.5px rgba(255,255,255,0.15) inset, 0 1px 0 rgba(255,255,255,0.2) inset, 0 4px 16px rgba(100,90,220,0.35)",
        }}
      >
        P
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Welcome to PACE
      </h1>
      <p className="mt-2 text-[14px] text-muted-foreground">
        Track work, not people.
      </p>

      <Button
        variant="primary"
        size="lg"
        className="mt-8 w-full"
        onClick={onContinue}
      >
        Get started
      </Button>
    </div>
  );
}

function ProfileStep({
  avatarColor,
  onColorChange,
  role,
  onRoleChange,
  onContinue,
  loading,
  userName,
}: {
  avatarColor: string;
  onColorChange: (c: string) => void;
  role: string;
  onRoleChange: (r: string) => void;
  onContinue: () => void;
  loading: boolean;
  userName: string;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          Set up your profile
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Pick a color and tell us what you do
        </p>
      </div>

      {/* Avatar preview */}
      <div className="flex justify-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white transition-colors duration-200"
          style={{ backgroundColor: avatarColor }}
        >
          {userName.charAt(0).toUpperCase() || "?"}
        </div>
      </div>

      {/* Color picker */}
      <div>
        <label className="mb-2 block text-[12px] font-medium text-muted-foreground">
          Avatar color
        </label>
        <div className="flex flex-wrap justify-center gap-2.5">
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onColorChange(color)}
              className={`h-8 w-8 rounded-full transition-all duration-150 ${
                avatarColor === color
                  ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110"
                  : "hover:scale-105 opacity-70 hover:opacity-100"
              }`}
              style={{ backgroundColor: color }}
              aria-label={`Select color ${color}`}
            />
          ))}
        </div>
      </div>

      {/* Role field */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Your role or title
        </label>
        <Input
          placeholder="e.g. Co-founder, Engineering"
          value={role}
          onChange={(e) => onRoleChange(e.target.value)}
          disabled={loading}
        />
      </div>

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={onContinue}
        disabled={loading}
      >
        {loading ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}

function TeamStep({
  teamMode,
  onModeChange,
  teamName,
  onTeamNameChange,
  inviteCode,
  onInviteCodeChange,
  generatedInviteCode,
  onContinue,
  loading,
}: {
  teamMode: "create" | "join";
  onModeChange: (m: "create" | "join") => void;
  teamName: string;
  onTeamNameChange: (n: string) => void;
  inviteCode: string;
  onInviteCodeChange: (c: string) => void;
  generatedInviteCode: string | null;
  onContinue: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          Set up your team
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Create a new team or join an existing one
        </p>
      </div>

      {/* Mode switcher */}
      <div className="flex rounded-lg bg-muted/40 p-1">
        <button
          type="button"
          onClick={() => onModeChange("create")}
          className={`flex-1 rounded-md py-2 text-[13px] font-semibold transition-all duration-200 ${
            teamMode === "create"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Create team
        </button>
        <button
          type="button"
          onClick={() => onModeChange("join")}
          className={`flex-1 rounded-md py-2 text-[13px] font-semibold transition-all duration-200 ${
            teamMode === "join"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Join team
        </button>
      </div>

      {teamMode === "create" ? (
        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-muted-foreground">
            Team name
          </label>
          <Input
            placeholder="e.g. Kenesis Labs"
            value={teamName}
            onChange={(e) => onTeamNameChange(e.target.value)}
            disabled={loading}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-muted-foreground">
            Invite code
          </label>
          <Input
            placeholder="Paste the 8-character code"
            value={inviteCode}
            onChange={(e) => onInviteCodeChange(e.target.value)}
            disabled={loading}
            className="font-mono tracking-wider"
          />
        </div>
      )}

      {/* Show generated invite code after team creation */}
      {generatedInviteCode && teamMode === "create" && (
        <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2.5">
          <p className="text-[11px] text-muted-foreground mb-1">
            Share this code with your team
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[15px] font-bold tracking-widest text-primary">
              {generatedInviteCode}
            </code>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(generatedInviteCode)
              }
              className="text-[11px] text-primary hover:text-primary/80 transition-colors font-medium"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={onContinue}
        disabled={loading}
      >
        {loading
          ? teamMode === "create"
            ? "Creating team…"
            : "Joining team…"
          : "Continue"}
      </Button>
    </div>
  );
}

function ProjectStep({
  projectName,
  onProjectNameChange,
  onContinue,
  loading,
}: {
  projectName: string;
  onProjectNameChange: (n: string) => void;
  onContinue: () => void;
  loading: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          Create your first project
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          What are you working on?
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Project name
        </label>
        <Input
          placeholder="e.g. PACE v2"
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          disabled={loading}
        />
      </div>

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={onContinue}
        disabled={loading}
      >
        {loading ? "Creating project…" : "Start tracking"}
      </Button>
    </div>
  );
}

/* ── Helpers ── */

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

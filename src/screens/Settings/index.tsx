/**
 * Settings Screen — Account section with full management features.
 *
 * - Profile editing: name, role, avatar color
 * - Change password
 * - Team info: team name, invite code (copy button), member list
 * - "Invite teammate" button → shows invite code + copy
 * - Logout button (clears auth, navigates to auth screen)
 *
 * Requirements: v1 Req 19.1 (extended)
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import { LogOut, Copy, Check, Users, KeyRound, UserPen, Globe } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { pb, setPocketBaseUrl } from "@/lib/pocketbase";
import { getUserTeam, getTeamMembers } from "@/lib/db";
import type { Team, TeamMembership } from "@/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

const AVATAR_COLORS = [
  "#6e6af6", "#d97706", "#3b9e6f", "#c45e8a",
  "#2563eb", "#dc2626", "#7c3aed", "#0891b2",
];

export default function SettingsScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[600px] space-y-6 px-4 sm:px-6 py-5 sm:py-6 pb-12">
        {/* Header with gradient accent */}
        <div className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div>
              <h1 className="text-[24px] sm:text-[26px] font-extrabold tracking-tight leading-tight">Settings</h1>
              <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-0.5 font-medium">
                Account, team, and server configuration
              </p>
            </div>
          </div>
        </div>

        {/* Account section */}
        <section className="space-y-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            Account
          </h2>
          {user && <ProfileEditor user={user} />}
          <ChangePassword />
        </section>

        {/* Team section */}
        <section className="space-y-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            Team
          </h2>
          {user && <TeamInfo userId={user.id} />}
        </section>

        {/* Server section */}
        <section className="space-y-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            Server & AI
          </h2>
          <ServerConfig />
        </section>

        {/* Logout */}
        <button
          onClick={() => {
            logout();
            router.navigate({ to: "/auth" });
          }}
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors w-full"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Profile Editor — name, role, avatar color
   ═══════════════════════════════════════════════════════════════ */

interface ProfileEditorProps {
  user: NonNullable<ReturnType<typeof useAuthStore.getState>["user"]>;
}

function ProfileEditor({ user }: ProfileEditorProps) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role ?? "");
  const [avatarColor, setAvatarColor] = useState(user.avatarColor);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== user.name ||
    role !== (user.role ?? "") ||
    avatarColor !== user.avatarColor;

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await pb.collection("users").update(user.id, {
        name: name.trim(),
        role: role.trim() || null,
        avatarColor,
      });
      useAuthStore.setState({
        user: {
          ...user,
          name: name.trim(),
          role: role.trim() || null,
          avatarColor,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Could not save profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass noise rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <UserPen className="h-4 w-4 text-muted-foreground" />
        Profile
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}

      {/* Avatar preview + color picker */}
      <div className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white transition-colors duration-200"
          style={{ backgroundColor: avatarColor }}
        >
          {name.charAt(0).toUpperCase() || "?"}
        </div>
        <div className="flex flex-wrap gap-2">
          {AVATAR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setAvatarColor(color)}
              className={`h-7 w-7 rounded-full transition-all duration-150 ${
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

      {/* Name */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          disabled={saving}
        />
      </div>

      {/* Role */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Role / Title
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            "Co-founder, Engineering",
            "Co-founder, Design",
            "Co-founder, Product",
            "Co-founder, Operations",
            "Co-founder, Marketing",
            "Engineering Lead",
            "Designer",
            "Product Manager",
            "Other",
          ].map((r) => (
            <button
              key={r}
              type="button"
              disabled={saving}
              onClick={() => setRole(r)}
              className={`rounded-lg px-3 py-2 text-[12px] font-medium text-left transition-all duration-150 border ${
                role === r
                  ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_8px_rgba(200,160,40,0.1)]"
                  : "border-border/50 bg-card/50 text-muted-foreground hover:text-foreground hover:border-border hover:bg-accent/30"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Save button */}
      <Button
        variant="primary"
        size="sm"
        onClick={handleSave}
        disabled={!dirty || saving}
        className="w-full"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
      </Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Change Password
   ═══════════════════════════════════════════════════════════════ */

function ChangePassword() {
  const user = useAuthStore((s) => s.user);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChangePassword() {
    setError(null);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!user) return;
    setSaving(true);
    try {
      await pb.collection("users").update(user.id, {
        oldPassword,
        password: newPassword,
        passwordConfirm: confirmPassword,
      });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch {
      setError("Could not change password. Check your current password.");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = oldPassword && newPassword && confirmPassword && !saving;

  return (
    <div className="glass noise rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        Change password
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-[12px] text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-[12px] text-emerald-400">
          Password changed successfully
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Current password
        </label>
        <Input
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          placeholder="Enter current password"
          disabled={saving}
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          New password
        </label>
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
          disabled={saving}
        />
      </div>
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Confirm new password
        </label>
        <Input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repeat new password"
          disabled={saving}
        />
      </div>

      <Button
        variant="secondary"
        size="sm"
        onClick={handleChangePassword}
        disabled={!canSubmit}
        className="w-full"
      >
        {saving ? "Changing…" : "Change password"}
      </Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Team Info — team name, invite code, member list, invite button
   ═══════════════════════════════════════════════════════════════ */

interface TeamMemberDisplay {
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string | null;
  joinedAt: number;
}

function TeamInfo({ userId }: { userId: string }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMemberDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const loadTeamData = useCallback(async () => {
    try {
      const t = await getUserTeam(userId);
      setTeam(t);
      if (t) {
        const memberships = await getTeamMembers(t.id);
        // Fetch user details for each member
        const memberDetails = await Promise.all(
          memberships.map(async (m: TeamMembership) => {
            try {
              const record = await pb.collection("users").getOne(m.userId);
              return {
                userId: m.userId,
                name: (record.name as string) ?? "Unknown",
                email: (record.email as string) ?? "",
                avatarColor: (record.avatarColor as string) ?? "#d97706",
                role: (record.role as string) ?? null,
                joinedAt: m.joinedAt,
              };
            } catch {
              return {
                userId: m.userId,
                name: "Unknown",
                email: "",
                avatarColor: "#d97706",
                role: null,
                joinedAt: m.joinedAt,
              };
            }
          }),
        );
        setMembers(memberDetails);
      }
    } catch {
      // Team data unavailable — show empty state
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  function handleCopyInviteCode() {
    if (!team) return;
    navigator.clipboard.writeText(team.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="glass noise rounded-xl p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" />
          Team
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">Loading team info…</p>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="glass noise rounded-xl p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" />
          Team
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          No team found. Complete onboarding to create or join a team.
        </p>
      </div>
    );
  }

  return (
    <div className="glass noise rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Users className="h-4 w-4 text-muted-foreground" />
        Team
      </div>

      {/* Team name */}
      <div className="space-y-1">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Team name
        </label>
        <p className="text-[14px] font-medium text-foreground">{team.name}</p>
      </div>

      {/* Invite code */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Invite code
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg inset-well px-3 py-2 font-mono text-[14px] font-bold tracking-widest text-primary">
            {team.inviteCode}
          </code>
          <button
            type="button"
            onClick={handleCopyInviteCode}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Copy invite code"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Invite teammate button */}
      {!showInvite ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowInvite(true)}
          className="w-full"
        >
          <Users className="h-3.5 w-3.5" />
          Invite teammate
        </Button>
      ) : (
        <div className="rounded-lg bg-primary/10 border border-primary/20 px-4 py-3 space-y-2 animate-slide-up">
          <p className="text-[12px] text-muted-foreground">
            Share this invite code with your teammate. They can use it during onboarding to join your team.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[16px] font-bold tracking-widest text-primary text-center">
              {team.inviteCode}
            </code>
            <button
              type="button"
              onClick={handleCopyInviteCode}
              className="text-[12px] text-primary hover:text-primary/80 transition-colors font-medium"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowInvite(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Member list */}
      <div className="space-y-2">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Members ({members.length})
        </label>
        <div className="space-y-1.5">
          {members.map((member) => (
            <div
              key={member.userId}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2.5"
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{ backgroundColor: member.avatarColor }}
              >
                {member.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-foreground truncate">
                  {member.name}
                  {member.userId === userId && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">(you)</span>
                  )}
                </p>
                {member.role && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {member.role}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Server Configuration — PocketBase URL + LiteLLM API key
   ═══════════════════════════════════════════════════════════════ */

function ServerConfig() {
  const [pbUrl, setPbUrl] = useState(() => {
    try { return localStorage.getItem("pace_pb_url") || "http://127.0.0.1:8090"; } catch { return "http://127.0.0.1:8090"; }
  });
  const [litellmKey, setLitellmKey] = useState(() => {
    try { return localStorage.getItem("pace_litellm_key") || ""; } catch { return ""; }
  });
  const [model, setModel] = useState(() => {
    try { return localStorage.getItem("pace_ai_model") || "gemini-flash"; } catch { return "gemini-flash"; }
  });
  const [saved, setSaved] = useState(false);

  function handleSave() {
    try {
      localStorage.setItem("pace_pb_url", pbUrl);
      localStorage.setItem("pace_litellm_key", litellmKey);
      localStorage.setItem("pace_ai_model", model);
      setPocketBaseUrl(pbUrl);
    } catch { /* storage unavailable */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="glass noise rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Globe className="h-4 w-4 text-muted-foreground" />
        Server Configuration
      </div>

      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          PocketBase URL
        </label>
        <Input
          value={pbUrl}
          onChange={(e) => setPbUrl(e.target.value)}
          placeholder="http://127.0.0.1:8090"
        />
        <p className="text-[10px] text-muted-foreground/60">
          The URL of your PocketBase server for data sync
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          LiteLLM API Key
        </label>
        <Input
          type="password"
          value={litellmKey}
          onChange={(e) => setLitellmKey(e.target.value)}
          placeholder="sk-… (optional)"
        />
        <p className="text-[10px] text-muted-foreground/60">
          Master key for your self-hosted LiteLLM proxy. Leave blank if using default.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-[12px] font-medium text-muted-foreground">
          AI Model ID
        </label>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. gemini-flash, claude-sonnet, gpt-4o"
        />
        <p className="text-[10px] text-muted-foreground/60">
          Any LiteLLM model name — matches your litellm_config.yaml model_list entries. Type any model ID your proxy supports.
        </p>
      </div>

      <Button variant="secondary" size="sm" onClick={handleSave} className="w-full">
        {saved ? "Saved ✓" : "Save server config"}
      </Button>
    </div>
  );
}

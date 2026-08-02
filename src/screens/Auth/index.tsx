/**
 * Auth Screen — Sign Up / Log In
 *
 * Full-screen auth screen (no sidebar). Two tabs: "Sign Up" and "Log In".
 * Skeuomorphic glass card centered on screen with golden accent primary button.
 * Calls PocketBase `users` collection for auth operations.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";
import {
  checkPocketBaseHealth,
  getPocketBaseUrl,
  normalizePocketBaseUrl,
  pb,
  setPocketBaseUrl,
} from "@/lib/pocketbase";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

type AuthTab = "signup" | "login";

interface FormErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  general?: string;
}

export default function AuthScreen() {
  const router = useRouter();
  const authLogin = useAuthStore((s) => s.login);
  const authSignup = useAuthStore((s) => s.signup);
  const [tab, setTab] = useState<AuthTab>("login");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  /* Sign Up fields */
  const [name, setName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  /* Log In fields */
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  /* Forgot password */
  const [forgotSent, setForgotSent] = useState(false);

  /* Server connection — available before authentication so packaged builds work. */
  const [serverUrl, setServerUrl] = useState(() => getPocketBaseUrl());
  const [serverState, setServerState] = useState<"idle" | "checking" | "online" | "offline">("idle");
  const [serverMessage, setServerMessage] = useState("");

  function clearErrors() {
    setErrors({});
  }

  function switchTab(next: AuthTab) {
    setTab(next);
    clearErrors();
    setForgotSent(false);
  }

  async function handleCheckServer() {
    setServerState("checking");
    setServerMessage("");
    try {
      const normalized = normalizePocketBaseUrl(serverUrl);
      setPocketBaseUrl(normalized);
      try { localStorage.setItem("pace_pb_url", normalized); } catch { /* storage unavailable */ }
      setServerUrl(normalized);
      await checkPocketBaseHealth();
      setServerState("online");
      setServerMessage("Server is reachable.");
    } catch (error) {
      setServerState("offline");
      setServerMessage(error instanceof Error ? error.message : "Could not reach the server.");
    }
  }

  /* ── Validation ── */

  function validateSignup(): FormErrors {
    const errs: FormErrors = {};
    if (!name.trim()) errs.name = "Full name is required";
    if (!signupEmail.trim()) {
      errs.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail)) {
      errs.email = "Enter a valid email address";
    }
    if (signupPassword.length < 8) {
      errs.password = "Password must be at least 8 characters";
    }
    if (signupPassword !== confirmPassword) {
      errs.confirmPassword = "Passwords do not match";
    }
    return errs;
  }

  function validateLogin(): FormErrors {
    const errs: FormErrors = {};
    if (!loginEmail.trim()) errs.email = "Email is required";
    if (!loginPassword.trim()) errs.password = "Password is required";
    return errs;
  }

  /* ── Handlers ── */

  async function handleSignup(e: FormEvent) {
    e.preventDefault();
    clearErrors();
    const errs = validateSignup();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setLoading(true);
    try {
      await authSignup(name.trim(), signupEmail.trim(), signupPassword);
      await storeAuthAndNavigate(true);
    } catch (err: unknown) {
      setErrors({ general: parseError(err, "signup") });
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    clearErrors();
    const errs = validateLogin();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setLoading(true);
    try {
      await authLogin(loginEmail.trim(), loginPassword);
      await storeAuthAndNavigate(false);
    } catch (err: unknown) {
      setErrors({ general: parseError(err, "login") });
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (!loginEmail.trim()) {
      setErrors({ email: "Enter your email first" });
      return;
    }
    setLoading(true);
    try {
      await pb.collection("users").requestPasswordReset(loginEmail.trim());
      setForgotSent(true);
    } catch {
      setErrors({ general: "Could not send reset email. Check the address and try again." });
    } finally {
      setLoading(false);
    }
  }

  async function storeAuthAndNavigate(isNewUser: boolean) {
    // Token persistence is handled by authStore.login/signup
    if (isNewUser) {
      router.navigate({ to: "/onboarding" });
    } else {
      router.navigate({ to: "/" });
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full opacity-15 blur-[120px]"
        style={{ background: "radial-gradient(circle, hsl(40 95% 52%) 0%, transparent 70%)" }}
      />

      {/* Glass card */}
      <div className="glass-elevated noise relative z-10 w-full max-w-[420px] rounded-2xl p-8 animate-scale-in">
        {/* Logo */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-black tracking-tight"
            style={{
              background: "linear-gradient(135deg, hsl(40 95% 56%) 0%, hsl(32 90% 42%) 100%)",
              color: "hsl(30 20% 8%)",
              boxShadow:
                "0 0 0 0.5px rgba(255,255,255,0.15) inset, 0 1px 0 rgba(255,255,255,0.2) inset, 0 2px 6px rgba(200,150,30,0.25)",
            }}
          >
            P
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">PACE</span>
        </div>

        {/* Tab switcher */}
        <div className="mb-6 flex rounded-lg bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => switchTab("signup")}
            className={`flex-1 rounded-md py-2 text-[13px] font-semibold transition-all duration-200 ${
              tab === "signup"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign Up
          </button>
          <button
            type="button"
            onClick={() => switchTab("login")}
            className={`flex-1 rounded-md py-2 text-[13px] font-semibold transition-all duration-200 ${
              tab === "login"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Log In
          </button>
        </div>

        <div className="mb-5 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-foreground">Sync server</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Set this once for the desktop app.</p>
            </div>
            <button
              type="button"
              onClick={handleCheckServer}
              disabled={loading || serverState === "checking"}
              className="shrink-0 text-[11px] font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50"
            >
              {serverState === "checking" ? "Checking…" : "Check connection"}
            </button>
          </div>
          <Input
            className="mt-2"
            aria-label="PocketBase server URL"
            value={serverUrl}
            onChange={(e) => {
              setServerUrl(e.target.value);
              setServerState("idle");
              setServerMessage("");
            }}
            placeholder="https://pace.example.com"
            autoComplete="url"
            disabled={loading || serverState === "checking"}
          />
          {serverMessage && (
            <p className={`mt-1.5 text-[10px] ${serverState === "online" ? "text-emerald-400" : "text-destructive"}`}>
              {serverMessage}
            </p>
          )}
        </div>

        {/* General error */}
        {errors.general && (
          <div className="mb-4 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-[12px] text-destructive">
            {errors.general}
          </div>
        )}

        {/* Sign Up form */}
        {tab === "signup" && (
          <form onSubmit={handleSignup} className="space-y-3.5">
            <FieldGroup label="Full name" error={errors.name}>
              <Input
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                disabled={loading}
              />
            </FieldGroup>

            <FieldGroup label="Email" error={errors.email}>
              <Input
                type="email"
                placeholder="jane@kenesis.io"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                autoComplete="email"
                disabled={loading}
              />
            </FieldGroup>

            <FieldGroup label="Password" error={errors.password}>
              <Input
                type="password"
                placeholder="At least 8 characters"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </FieldGroup>

            <FieldGroup label="Confirm password" error={errors.confirmPassword}>
              <Input
                type="password"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </FieldGroup>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-2 w-full"
              disabled={loading}
            >
              {loading ? "Creating account…" : "Create account"}
            </Button>
          </form>
        )}

        {/* Log In form */}
        {tab === "login" && (
          <form onSubmit={handleLogin} className="space-y-3.5">
            <FieldGroup label="Email" error={errors.email}>
              <Input
                type="email"
                placeholder="jane@kenesis.io"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                autoComplete="email"
                disabled={loading}
              />
            </FieldGroup>

            <FieldGroup label="Password" error={errors.password}>
              <Input
                type="password"
                placeholder="Enter your password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
              />
            </FieldGroup>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={loading}
                className="text-[12px] text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
              >
                Forgot password?
              </button>
            </div>

            {forgotSent && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-[12px] text-emerald-400">
                Password reset email sent. Check your inbox.
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          Track work, not people.
        </p>
      </div>
    </div>
  );
}

/* ── Field group helper ── */

function FieldGroup({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12px] font-medium text-muted-foreground">{label}</label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

/* ── Error parser ── */

function parseError(err: unknown, context: "signup" | "login"): string {
  const response = typeof err === "object" && err !== null && "response" in err
    ? (err as { response?: { data?: Record<string, { message?: string; code?: string }> } }).response
    : undefined;
  const message = err instanceof Error ? err.message : String(err);
  const fieldMessages = Object.values(response?.data ?? {})
    .map((field) => field?.message ?? "")
    .filter(Boolean)
    .join(" ");

  const lower = `${message} ${fieldMessages}`.toLowerCase();

  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econnrefused") || lower.includes("could not be reached")) {
    return `Cannot reach ${getPocketBaseUrl()}. Check the Sync server URL and make sure PocketBase is running.`;
  }

  if (context === "signup") {
    if (lower.includes("already") || lower.includes("unique") || lower.includes("exists")) {
      return "An account with this email already exists. Try logging in.";
    }
    if (lower.includes("password") && (lower.includes("short") || lower.includes("min") || lower.includes("length"))) {
      return "Password is too short. Use at least 8 characters.";
    }
    if (lower.includes("email") && (lower.includes("invalid") || lower.includes("valid"))) {
      return "Enter a valid email address.";
    }
  }

  if (context === "login") {
    if (lower.includes("invalid") || lower.includes("failed") || lower.includes("wrong") || lower.includes("credentials")) {
      return "Invalid email or password. Please try again.";
    }
  }

  return context === "signup"
    ? "Could not create account. Please try again."
    : "Could not sign in. Please check your credentials.";
}

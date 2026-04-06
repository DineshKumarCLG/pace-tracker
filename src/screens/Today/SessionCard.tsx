import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { Coffee, Pause, Play, ArrowRightLeft, LogOut, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/stores/sessionStore";
import { useTaskStore } from "@/stores/taskStore";
import Timer, { formatDuration } from "@/components/Timer";
import EndDayFlow from "@/components/EndDayFlow";
import { startBreak, endBreak, endSession } from "@/lib/db";

type SessionState = "active" | "break" | "ended";
function getSessionState(has: boolean, onBreak: boolean): SessionState {
  if (!has) return "ended"; if (onBreak) return "break"; return "active";
}

const BREAK_TYPES = [
  { value: "lunch" as const, label: "Lunch", emoji: "🍽" },
  { value: "short" as const, label: "Short", emoji: "☕" },
  { value: "meeting" as const, label: "Meeting", emoji: "👥" },
];

function useBreakTimer() {
  const session = useSessionStore((s) => s.session);
  const breakState = useSessionStore((s) => s.breakState);
  const clearSession = useSessionStore((s) => s.clearSession);
  const [elapsed, setElapsed] = useState(0);
  const warnedRef = useRef(false);
  useEffect(() => {
    if (!breakState.active || !breakState.startTime) { setElapsed(0); warnedRef.current = false; return; }
    function tick() {
      const e = Math.max(0, Math.floor(Date.now() / 1000) - breakState.startTime!);
      setElapsed(e);
      if (e >= 5400 && !warnedRef.current) { warnedRef.current = true; notify(); }
      if (e >= 6300 && session) close(session.id, breakState.startTime!);
    }
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [breakState.active, breakState.startTime, session]);
  async function close(sid: string, t: number) { try { await endSession(sid, t); clearSession(); } catch {} }
  return elapsed;
}
async function notify() {
  try {
    const { sendNotification, isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
    let ok = await isPermissionGranted(); if (!ok) { ok = (await requestPermission()) === "granted"; }
    if (ok) sendNotification({ title: "PACE", body: "Still on break? Resume or end your day." });
  } catch {}
}

/* Pill button on the card surface */
function CardBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur-sm border border-white/[0.08] bg-white/[0.08] transition-all duration-150 hover:bg-white/[0.15] active:scale-[0.97]"
      style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(255,255,255,0.04) inset" }}
    >{children}</button>
  );
}

export default function SessionCard() {
  const session = useSessionStore((s) => s.session);
  const breakState = useSessionStore((s) => s.breakState);
  const setBreakState = useSessionStore((s) => s.setBreakState);
  const setPaused = useSessionStore((s) => s.setPaused);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const [showEndDay, setShowEndDay] = useState(false);
  const [showBreakMenu, setShowBreakMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const state = getSessionState(!!session, breakState.active);
  const activeTask = tasks.find((t) => t.id === activeTaskId);
  const breakElapsed = useBreakTimer();

  useEffect(() => {
    if (!showBreakMenu) return;
    function h(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowBreakMenu(false); }
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [showBreakMenu]);

  const doBreak = useCallback(async (t: "lunch"|"short"|"meeting") => {
    if (!session) return; setShowBreakMenu(false);
    try { const b = await startBreak(session.id, t); setBreakState({ active: true, breakId: b.id, type: t, startTime: b.startTime }); setPaused(true); } catch {}
  }, [session, setBreakState, setPaused]);

  const doResume = useCallback(async () => {
    if (!breakState.breakId) return;
    try { await endBreak(breakState.breakId); setBreakState({ active: false, breakId: null, type: null, startTime: null }); setPaused(false); } catch {}
  }, [breakState.breakId, setBreakState, setPaused]);

  if (showEndDay) return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex justify-center"
    >
      <EndDayFlow onCancel={() => setShowEndDay(false)} />
    </motion.div>
  );

  const labels: Record<SessionState, string> = { active: "Working", break: "On Break", ended: "Ended" };

  /* Card gradient + 3D shadow per state */
  const cardStyle: Record<SessionState, React.CSSProperties> = {
    active: {
      background: "linear-gradient(145deg, hsl(42 95% 54%) 0%, hsl(36 90% 40%) 100%)",
      boxShadow: "0 0 0 0.5px rgba(255,255,255,0.1) inset, 0 1px 0 rgba(255,255,255,0.12) inset, 0 -1px 0 rgba(0,0,0,0.1) inset, 0 4px 16px rgba(200,150,30,0.25), 0 12px 40px rgba(200,150,30,0.12)",
    },
    break: {
      background: "linear-gradient(145deg, hsl(24 92% 52%) 0%, hsl(18 88% 38%) 100%)",
      boxShadow: "0 0 0 0.5px rgba(255,255,255,0.1) inset, 0 1px 0 rgba(255,255,255,0.12) inset, 0 -1px 0 rgba(0,0,0,0.1) inset, 0 4px 16px rgba(220,100,20,0.25), 0 12px 40px rgba(220,100,20,0.12)",
    },
    ended: {
      background: "linear-gradient(145deg, hsl(225 8% 35%) 0%, hsl(225 8% 25%) 100%)",
      boxShadow: "0 0 0 0.5px rgba(255,255,255,0.05) inset, 0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 12px rgba(0,0,0,0.15)",
    },
  };

  return (
    <div className="relative">
      {/* Ambient glow */}
      <div className={cn(
        "absolute -inset-3 rounded-3xl blur-2xl",
        state === "active" && "bg-amber-500/12 animate-glow-pulse",
        state === "break" && "bg-orange-500/12 animate-glow-pulse",
        state === "ended" && "bg-transparent",
      )} />

      <div className="relative overflow-hidden rounded-[var(--radius-session-card)] noise" style={cardStyle[state]}>
        {/* Decorative orb */}
        <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-white/[0.05] blur-xl" />

        <div className="relative p-5 text-white">
          {/* Top row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {state === "active" && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
              )}
              {state === "break" && <Coffee className="h-3.5 w-3.5 opacity-70" />}
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] opacity-60">{labels[state]}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {session && <CardBtn onClick={() => setShowEndDay(true)} label="End day"><LogOut className="h-3 w-3" />End</CardBtn>}
              {session && !breakState.active && (
                <div className="relative" ref={menuRef}>
                  <CardBtn onClick={() => setShowBreakMenu(v => !v)} label="Break">
                    <Pause className="h-3 w-3" />Break<ChevronDown className="h-2.5 w-2.5 opacity-50" />
                  </CardBtn>
                  {showBreakMenu && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-1.5 z-20 min-w-[130px] rounded-xl glass-elevated p-1"
                    >
                      {BREAK_TYPES.map(bt => (
                        <button key={bt.value} onClick={() => doBreak(bt.value)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-foreground font-medium hover:bg-accent/60 transition-colors">
                          <span className="text-sm">{bt.emoji}</span>{bt.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </div>
              )}
              {session && breakState.active && <CardBtn onClick={doResume} label="Resume"><Play className="h-3 w-3" />Resume</CardBtn>}
            </div>
          </div>

          {/* Timer */}
          <div className="mt-5 mb-1">
            {session ? (
              breakState.active
                ? <span className="font-mono text-[32px] sm:text-[42px] font-extrabold tabular-nums tracking-tighter leading-none">{formatDuration(breakElapsed)}</span>
                : <Timer />
            ) : (
              <span className="font-mono text-[32px] sm:text-[42px] font-extrabold tabular-nums tracking-tighter leading-none opacity-25">00:00:00</span>
            )}
          </div>

          {/* Task */}
          {session && (
            <div className="flex items-center gap-1.5 mt-2 opacity-60">
              <ArrowRightLeft className="h-3 w-3" />
              <span className="text-[12px] font-medium">{activeTask ? activeTask.title : "No task selected"}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";

export function useElapsedTime(): number {
  const session = useSessionStore((s) => s.session);
  const breakState = useSessionStore((s) => s.breakState);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!session) { setElapsed(0); return; }
    function tick() {
      const now = Math.floor(Date.now() / 1000);
      let total = now - session!.startTime;
      if (breakState.active && breakState.startTime) total -= now - breakState.startTime;
      setElapsed(Math.max(0, total));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session, breakState]);
  return elapsed;
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Timer() {
  const elapsed = useElapsedTime();
  return (
    <span className="font-mono text-[32px] sm:text-[42px] font-extrabold tabular-nums tracking-tighter leading-none">
      {formatDuration(elapsed)}
    </span>
  );
}

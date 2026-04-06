import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Play, Clock, ListChecks, Coffee, Zap } from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";
import { useElapsedTime } from "@/components/Timer";
import StartSessionFlow from "@/components/StartSessionFlow";
import Card from "@/components/ui/Card";
import { sectionLabel } from "@/lib/variants";
import SessionCard from "./SessionCard";
import ActivityTimeline from "./ActivityTimeline";
import SessionLog from "./SessionLog";
import OutputNote from "./OutputNote";

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };
const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } },
};

function KpiRow() {
  const elapsed = useElapsedTime();
  const session = useSessionStore((s) => s.session);
  if (!session) return null;
  const hours = (elapsed / 3600).toFixed(1);
  return (
    <motion.div variants={fadeUp} className="grid grid-cols-3 gap-2 sm:gap-3">
      <KpiCard icon={<Clock className="h-3.5 w-3.5" />} label="Hours" value={`${hours}h`} />
      <KpiCard icon={<ListChecks className="h-3.5 w-3.5" />} label="Tasks" value="—" />
      <KpiCard icon={<Coffee className="h-3.5 w-3.5" />} label="Breaks" value="—" />
    </motion.div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <motion.div whileHover={{ y: -2 }} whileTap={{ y: 0 }}>
      <Card className="cursor-default hover-lift">
        <div className="relative p-3 sm:p-3.5">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            {icon}
            <span className={sectionLabel()}>{label}</span>
          </div>
          <p className="text-lg sm:text-[22px] font-bold tabular-nums tracking-tight leading-none">{value}</p>
        </div>
      </Card>
    </motion.div>
  );
}

function StartDayPrompt() {
  const [showFlow, setShowFlow] = useState(false);

  return (
    <AnimatePresence mode="wait">
      {showFlow ? (
        <motion.div
          key="flow"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex justify-center"
        >
          <StartSessionFlow onCancel={() => setShowFlow(false)} />
        </motion.div>
      ) : (
        <motion.button
          key="prompt"
          variants={fadeUp}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => setShowFlow(true)}
          className="group relative w-full overflow-hidden rounded-[var(--radius-session-card)] glass noise p-6 sm:p-8 text-center"
        >
          <div className="absolute -top-10 -right-10 h-28 w-28 rounded-full bg-primary/[0.06] blur-2xl animate-float" />
          <div className="relative flex flex-col items-center gap-3 sm:gap-4">
            <div className="relative">
              <div className="absolute -inset-2 rounded-2xl bg-primary/10 blur-lg animate-breathe" />
              <div className="relative flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl btn-3d">
                <Play className="h-5 w-5 sm:h-6 sm:w-6 ml-0.5" />
              </div>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight">Start your day</h2>
              <p className="mt-1 text-[12px] sm:text-[13px] text-muted-foreground leading-relaxed">Begin tracking — your flow starts here</p>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40 font-medium">
              <Zap className="h-3 w-3" />
              Click to begin
            </div>
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export default function TodayScreen() {
  const session = useSessionStore((s) => s.session);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="h-full overflow-y-auto">
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-[720px] space-y-5 px-4 sm:px-6 py-5 sm:py-6 pb-12"
      >
        {/* Header with gradient accent */}
        <motion.div variants={fadeUp} className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div>
              <h1 className="text-[24px] sm:text-[26px] font-extrabold tracking-tight leading-tight">
                {greeting}
              </h1>
              <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-0.5 font-medium">
                {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Session card or start prompt */}
        <motion.div variants={fadeUp}>
          {session ? <SessionCard /> : <StartDayPrompt />}
        </motion.div>

        {/* KPI metrics */}
        <KpiRow />

        {/* Two-column layout for timeline + output note */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div variants={fadeUp}><ActivityTimeline /></motion.div>
          <motion.div variants={fadeUp}><OutputNote /></motion.div>
        </div>

        {/* Session log full width */}
        <motion.div variants={fadeUp}><SessionLog /></motion.div>
      </motion.div>
    </div>
  );
}

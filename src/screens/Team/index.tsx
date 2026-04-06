import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTeamStore } from "@/stores/teamStore";
import MemberCard from "./MemberCard";
import WeekGrid from "./WeekGrid";

type Tab = "today" | "week";

export default function TeamScreen() {
  const [tab, setTab] = useState<Tab>("today");
  const members = useTeamStore((s) => s.members);
  const loadMockMembers = useTeamStore((s) => s.loadMockMembers);

  useEffect(() => {
    if (Object.keys(members).length === 0) {
      loadMockMembers();
    }
  }, []);

  const memberList = Object.values(members);
  const activeCount = memberList.filter((m) => m.status === "active").length;
  const breakCount = memberList.filter((m) => m.status === "on_break").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[780px] space-y-5 px-4 sm:px-6 py-5 sm:py-6 pb-12">
        {/* Header with gradient accent + live stats */}
        <div className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div className="flex-1">
              <h1 className="text-[24px] sm:text-[26px] font-extrabold tracking-tight leading-tight">Team</h1>
              <p className="text-[12px] sm:text-[13px] text-muted-foreground mt-0.5 font-medium">
                {memberList.length} member{memberList.length !== 1 ? "s" : ""}
                {activeCount > 0 && <span className="text-emerald-400 ml-2">● {activeCount} active</span>}
                {breakCount > 0 && <span className="text-amber-400 ml-2">● {breakCount} on break</span>}
              </p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 rounded-lg inset-well w-fit">
          {(["today", "week"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-4 py-1.5 text-[12px] font-semibold transition-all duration-150",
                tab === t
                  ? "btn-ghost text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "today" ? "Today" : "This Week"}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === "today" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-slide-up">
            {memberList.length === 0 ? (
              <div className="glass noise rounded-xl p-8 text-center col-span-full">
                <p className="text-[13px] text-muted-foreground">No team members online</p>
              </div>
            ) : (
              memberList.map((m) => <MemberCard key={m.userId} member={m} />)
            )}
          </div>
        ) : (
          <div className="animate-slide-up">
            <WeekGrid members={memberList} />
          </div>
        )}
      </div>
    </div>
  );
}

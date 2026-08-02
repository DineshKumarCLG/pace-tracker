import { useState } from "react";
import { Link, useRouterState, useRouter } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  BarChart3,
  Settings,
  LogOut,
  Gauge,
  CalendarClock,
  Palmtree,
  ClipboardCheck,
  TrendingUp,
  Newspaper,
  UserCheck,
  Trophy,
  PieChart,
  HeartPulse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/authStore";
import { isFounder } from "@/lib/roles";
import ThemeToggle from "@/components/ThemeToggle";

type NavItem =
  | { type: "item"; to: string; label: string; icon: typeof LayoutDashboard }
  | { type: "divider"; label: string };

const baseNavItems: NavItem[] = [
  { type: "item", to: "/", label: "Today", icon: LayoutDashboard },
  { type: "item", to: "/team", label: "Team", icon: Users },
  { type: "item", to: "/tasks", label: "Tasks", icon: CheckSquare },
  { type: "item", to: "/review", label: "Review", icon: BarChart3 },
  { type: "divider", label: "Team Ops" },
  { type: "item", to: "/dashboard", label: "Dashboard", icon: Gauge },
  { type: "item", to: "/attendance", label: "Attendance", icon: CalendarClock },
  { type: "item", to: "/leave", label: "Leave", icon: Palmtree },
  { type: "item", to: "/requests", label: "Requests", icon: ClipboardCheck },
  { type: "item", to: "/analytics", label: "Analytics", icon: TrendingUp },
  { type: "item", to: "/digest", label: "Digest", icon: Newspaper },
];

const governanceNavItems: NavItem[] = [
  { type: "divider", label: "Governance" },
  { type: "item", to: "/founder-review", label: "Founder Review", icon: UserCheck },
  { type: "item", to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { type: "item", to: "/equity", label: "Equity", icon: PieChart },
  { type: "item", to: "/startup-health", label: "Startup Health", icon: HeartPulse },
];

const bottomNavItems: NavItem[] = [
  { type: "divider", label: "" },
  { type: "item", to: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const routerState = useRouterState();
  const router = useRouter();
  const currentPath = routerState.location.pathname;
  const [hovered, setHovered] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const showGovernance = isFounder(user?.role ?? null);

  const navItems: NavItem[] = [
    ...baseNavItems,
    ...(showGovernance ? governanceNavItems : []),
    ...bottomNavItems,
  ];

  return (
    <aside className="relative flex h-screen w-[220px] flex-col">
      {/* Background surface */}
      <div className="absolute inset-0 bg-sidebar" />
      <div className="absolute right-0 inset-y-0 w-px bg-sidebar-border" />

      {/* Logo */}
      <div className="relative z-10 flex h-14 items-center gap-2.5 px-4">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-black tracking-tight"
          style={{
            background: "linear-gradient(135deg, hsl(40 95% 56%) 0%, hsl(32 90% 42%) 100%)",
            color: "hsl(30 20% 8%)",
            boxShadow: "0 0 0 0.5px rgba(255,255,255,0.15) inset, 0 1px 0 rgba(255,255,255,0.2) inset, 0 2px 6px rgba(200,150,30,0.25)",
          }}
        >
          P
        </div>
        <span className="text-sm font-bold tracking-tight text-foreground">PACE</span>
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex-1 space-y-0.5 px-2.5 pt-1 overflow-y-auto">
        {navItems.map((item, idx) => {
          if (item.type === "divider") {
            return (
              <div key={`divider-${idx}`} className="pt-2 pb-1 px-3">
                {item.label ? (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">
                    {item.label}
                  </span>
                ) : (
                  <div className="border-t border-sidebar-border/40" />
                )}
              </div>
            );
          }

          const { to, label, icon: Icon } = item;
          const active = to === "/" ? currentPath === "/" : currentPath.startsWith(to);
          const isHov = hovered === to;
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              onMouseEnter={() => setHovered(to)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] font-medium transition-all duration-200",
                active ? "text-session-active-foreground" : "text-sidebar-foreground hover:text-foreground",
              )}
            >
              {active && (
                <div
                  className="absolute inset-0 rounded-lg"
                  style={{
                    background: "linear-gradient(135deg, hsl(40 95% 54%) 0%, hsl(35 90% 42%) 100%)",
                    boxShadow: "0 0 0 0.5px rgba(255,255,255,0.12) inset, 0 1px 0 rgba(255,255,255,0.15) inset, 0 -1px 0 rgba(0,0,0,0.1) inset, 0 2px 6px rgba(200,150,30,0.2)",
                  }}
                />
              )}
              {!active && isHov && (
                <div className="absolute inset-0 rounded-lg bg-sidebar-accent/70" />
              )}
              <Icon className={cn("relative z-10 h-4 w-4 shrink-0 transition-transform duration-200", isHov && !active && "scale-105")} />
              <span className="relative z-10">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom: theme toggle + user */}
      <div className="relative z-10 space-y-2 p-2.5">
        <div className="flex justify-center">
          <ThemeToggle />
        </div>
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-sidebar-accent/50 transition-colors cursor-pointer">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold"
            style={{
              background: `linear-gradient(135deg, ${user?.avatarColor ?? "hsl(40 90% 52%)"} 0%, ${user?.avatarColor ?? "hsl(32 85% 40%)"} 100%)`,
              color: "hsl(30 20% 8%)",
              boxShadow: "0 1px 3px rgba(200,150,30,0.2)",
            }}
          >
            {user?.name?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[12px] font-medium truncate">{user?.name ?? "Guest"}</span>
            <span className="text-[10px] text-muted-foreground truncate">Active</span>
          </div>
          <div className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/40" />
        </div>
        <button
          onClick={() => {
            logout();
            router.navigate({ to: "/auth" });
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-destructive hover:bg-sidebar-accent/50 transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Log out
        </button>
      </div>
    </aside>
  );
}

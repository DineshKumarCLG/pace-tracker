import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const modes = [
  { value: "dark" as const, icon: Moon, tip: "Dark" },
  { value: "light" as const, icon: Sun, tip: "Light" },
  { value: "system" as const, icon: Monitor, tip: "System" },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="flex items-center rounded-xl p-0.5"
      style={{
        background: "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--muted)) 100%)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25) inset, 0 -1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.1)",
      }}
      role="radiogroup"
      aria-label="Theme"
    >
      {modes.map(({ value, icon: Icon, tip }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            role="radio"
            aria-checked={active}
            aria-label={tip}
            title={tip}
            className={cn(
              "relative flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-250",
              active
                ? "text-foreground"
                : "text-muted-foreground/50 hover:text-muted-foreground",
            )}
          >
            {active && (
              <div
                className="absolute inset-0 rounded-lg"
                style={{
                  background: "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--accent)) 100%)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.06) inset, 0 1px 0 rgba(255,255,255,0.08) inset",
                }}
              />
            )}
            <Icon className="relative z-10 h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

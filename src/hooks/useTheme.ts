import { useEffect } from "react";
import { useUiStore } from "@/stores/uiStore";

export function useTheme() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    if (theme === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      // Default root is dark, add "light" class for light mode
      if (!prefersDark) root.classList.add("light");
    } else if (theme === "light") {
      root.classList.add("light");
    }
    // dark = default (no class needed, :root is dark)
  }, [theme]);

  function cycleTheme() {
    const order: Array<"dark" | "light" | "system"> = ["dark", "light", "system"];
    const idx = order.indexOf(theme as "dark" | "light" | "system");
    setTheme(order[(idx + 1) % order.length]);
  }

  return { theme, setTheme, cycleTheme };
}

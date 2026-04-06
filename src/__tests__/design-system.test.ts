/**
 * Design System Token Tests
 * Validates: Requirement 19.1
 *
 * Tests CSS custom properties defined in globals.css by parsing the file content.
 * Verifies light/dark mode tokens, font definitions, and component-specific radii.
 */
/// <reference types="node" />
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cssContent: string;

beforeAll(() => {
  cssContent = fs.readFileSync(
    path.resolve(__dirname, "../styles/globals.css"),
    "utf-8"
  );
});

/** Extract a CSS block by its selector (e.g. ":root", ".dark", "@theme inline") */
function extractBlock(css: string, selector: string): string {
  if (selector === "@theme inline") {
    const start = css.indexOf("@theme inline");
    if (start === -1) return "";
    let braceCount = 0;
    let blockStart = -1;
    for (let i = start; i < css.length; i++) {
      if (css[i] === "{") {
        if (blockStart === -1) blockStart = i;
        braceCount++;
      } else if (css[i] === "}") {
        braceCount--;
        if (braceCount === 0) return css.slice(blockStart + 1, i);
      }
    }
    return "";
  }

  // For :root and .dark selectors
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escapedSelector}\\s*\\{`, "g");
  const match = regex.exec(css);
  if (!match) return "";

  let braceCount = 0;
  let blockStart = -1;
  for (let i = match.index; i < css.length; i++) {
    if (css[i] === "{") {
      if (blockStart === -1) blockStart = i;
      braceCount++;
    } else if (css[i] === "}") {
      braceCount--;
      if (braceCount === 0) return css.slice(blockStart + 1, i);
    }
  }
  return "";
}

/** Extract all --property names from a CSS block */
function extractCustomProperties(block: string): string[] {
  const matches = block.match(/--[\w-]+(?=\s*:)/g);
  return matches ? [...new Set(matches)] : [];
}

// All tokens that must exist in both :root and .dark
const requiredTokens = [
  // Core UI tokens
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  // Sidebar tokens
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  // PACE session state tokens
  "--session-active",
  "--session-active-foreground",
  "--session-break",
  "--session-break-foreground",
  "--session-ended",
  "--session-ended-foreground",
  "--session-away",
  "--session-away-foreground",
  // PACE-specific tokens
  "--glass-bg",
  "--glass-border",
  "--glass-blur",
];

describe("Design System Tokens", () => {
  describe("Dark mode (:root) tokens", () => {
    it("should define all required CSS custom properties", () => {
      const rootBlock = extractBlock(cssContent, ":root");
      const rootProps = extractCustomProperties(rootBlock);

      for (const token of requiredTokens) {
        expect(rootProps, `Missing dark mode token: ${token}`).toContain(
          token
        );
      }
    });
  });

  describe("Light mode (.light) tokens", () => {
    it("should define all required CSS custom properties", () => {
      const lightBlock = extractBlock(cssContent, ".light");
      const lightProps = extractCustomProperties(lightBlock);

      for (const token of requiredTokens) {
        expect(lightProps, `Missing light mode token: ${token}`).toContain(token);
      }
    });
  });

  describe("Theme parity between dark and light mode", () => {
    it("should have matching token sets in :root and .light", () => {
      const rootBlock = extractBlock(cssContent, ":root");
      const lightBlock = extractBlock(cssContent, ".light");
      const rootProps = extractCustomProperties(rootBlock);
      const lightProps = extractCustomProperties(lightBlock);

      const missingInLight = rootProps.filter((p) => !lightProps.includes(p));
      const missingInDark = lightProps.filter((p) => !rootProps.includes(p));

      expect(
        missingInLight,
        `Tokens in :root but missing in .light: ${missingInLight.join(", ")}`
      ).toEqual([]);
      expect(
        missingInDark,
        `Tokens in .light but missing in :root: ${missingInDark.join(", ")}`
      ).toEqual([]);
    });
  });
});

describe("Typography", () => {
  it("should define Geist sans font-face", () => {
    expect(cssContent).toMatch(/font-family:\s*"Geist"/);
    expect(cssContent).toMatch(/GeistVariable\.woff2/);
  });

  it("should define Geist Mono font-face", () => {
    expect(cssContent).toMatch(/font-family:\s*"Geist Mono"/);
    expect(cssContent).toMatch(/GeistMonoVariable\.woff2/);
  });

  it("should set --font-sans to Geist in @theme inline", () => {
    const themeBlock = extractBlock(cssContent, "@theme inline");
    expect(themeBlock).toMatch(/--font-sans:\s*"Geist"/);
  });

  it("should set --font-mono to Geist Mono in @theme inline", () => {
    const themeBlock = extractBlock(cssContent, "@theme inline");
    expect(themeBlock).toMatch(/--font-mono:\s*"Geist Mono"/);
  });
});

describe("Component border-radius tokens", () => {
  let themeBlock: string;

  beforeAll(() => {
    themeBlock = extractBlock(cssContent, "@theme inline");
  });

  it("should define session card border-radius as 1.25rem (20px)", () => {
    expect(themeBlock).toMatch(/--radius-session-card:\s*1\.25rem/);
  });

  it("should define KPI card border-radius as 1rem (16px)", () => {
    expect(themeBlock).toMatch(/--radius-kpi-card:\s*1rem/);
  });

  it("should define idle modal border-radius as 1.5rem (24px)", () => {
    expect(themeBlock).toMatch(/--radius-idle-modal:\s*1\.5rem/);
  });
});

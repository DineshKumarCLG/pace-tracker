/**
 * PACE Component Variant System
 *
 * Follows HeroUI v3 principles:
 * - Semantic intent over visual style (primary/secondary/tertiary/danger)
 * - Consistent size tokens (sm/md/lg)
 * - Separation of styles and logic
 * - Type safety first
 *
 * Keeps the golden amber skeuomorphic aesthetic.
 */

import { cn } from "./utils";

/* ── Button Variants ── */

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const buttonBase = "inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none select-none";

const buttonVariantStyles: Record<ButtonVariant, string> = {
  primary: "btn-3d text-[hsl(30,20%,8%)]",
  secondary: "btn-ghost text-foreground border border-border",
  tertiary: "text-muted-foreground hover:text-foreground hover:bg-accent/50",
  danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-accent/40",
};

const buttonSizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-9 px-4 text-[13px]",
  lg: "h-10 px-5 text-[14px]",
};

export function buttonVariants(opts: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  const { variant = "primary", size = "md", className } = opts;
  return cn(buttonBase, buttonVariantStyles[variant], buttonSizeStyles[size], className);
}

/* ── Badge / Chip Variants ── */

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "muted";
export type BadgeSize = "sm" | "md";

const badgeBase = "inline-flex items-center gap-1 rounded-full font-semibold border";

const badgeVariantStyles: Record<BadgeVariant, string> = {
  default: "bg-primary/10 text-primary border-primary/20 shadow-[0_0_8px_rgba(200,160,40,0.08)]",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.08)]",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-[0_0_8px_rgba(245,158,11,0.08)]",
  danger: "bg-destructive/10 text-destructive border-destructive/20 shadow-[0_0_8px_rgba(239,68,68,0.08)]",
  muted: "bg-muted/50 text-muted-foreground border-border/40",
};

const badgeSizeStyles: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-[11px]",
};

export function badgeVariants(opts: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}): string {
  const { variant = "default", size = "sm", className } = opts;
  return cn(badgeBase, badgeVariantStyles[variant], badgeSizeStyles[size], className);
}

/* ── Card Variants ── */

export type CardVariant = "glass" | "elevated" | "inset" | "flat";

const cardVariantStyles: Record<CardVariant, string> = {
  glass: "glass noise rounded-xl",
  elevated: "glass-elevated noise rounded-xl",
  inset: "inset-well rounded-xl",
  flat: "bg-card rounded-xl border border-border",
};

export function cardVariants(opts: {
  variant?: CardVariant;
  className?: string;
}): string {
  const { variant = "glass", className } = opts;
  return cn(cardVariantStyles[variant], className);
}

/* ── Input Variants ── */

export type InputSize = "sm" | "md" | "lg";

const inputBase = "w-full rounded-lg inset-well text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-40 disabled:cursor-not-allowed";

const inputSizeStyles: Record<InputSize, string> = {
  sm: "px-2.5 py-1.5 text-[12px]",
  md: "px-3.5 py-2.5 text-[13px]",
  lg: "px-4 py-3 text-[14px]",
};

export function inputVariants(opts: {
  size?: InputSize;
  className?: string;
}): string {
  const { size = "md", className } = opts;
  return cn(inputBase, inputSizeStyles[size], className);
}

/* ── Section Label ── */

export function sectionLabel(className?: string): string {
  return cn("text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60", className);
}

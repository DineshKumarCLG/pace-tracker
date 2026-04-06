/**
 * PACE Badge — Semantic status badges.
 *
 * Variants: default (primary), success, warning, danger, muted
 * Sizes: sm, md
 */

import { forwardRef } from "react";
import { badgeVariants, type BadgeVariant, type BadgeSize } from "@/lib/variants";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "default", size = "sm", className, children, ...props }, ref) => (
    <span ref={ref} className={badgeVariants({ variant, size, className })} {...props}>
      {children}
    </span>
  ),
);

Badge.displayName = "Badge";
export default Badge;

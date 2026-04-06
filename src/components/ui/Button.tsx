/**
 * PACE Button — Semantic intent variants following HeroUI v3 principles.
 *
 * Variants: primary (golden 3D), secondary (ghost border), tertiary (text-only),
 *           danger (destructive), ghost (minimal)
 * Sizes: sm, md, lg
 *
 * Keeps the skeuomorphic golden amber aesthetic.
 */

import { forwardRef } from "react";
import { buttonVariants, type ButtonVariant, type ButtonSize } from "@/lib/variants";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, children, ...props }, ref) => (
    <button
      ref={ref}
      className={buttonVariants({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  ),
);

Button.displayName = "Button";
export default Button;

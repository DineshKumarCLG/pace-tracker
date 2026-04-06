/**
 * PACE Card — Glass/elevated/inset surface variants with premium hover effects.
 */

import { forwardRef } from "react";
import { cardVariants, type CardVariant } from "@/lib/variants";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  glow?: boolean;
  interactive?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "glass", glow = false, interactive = false, className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        cardVariants({ variant }),
        "transition-all duration-200",
        interactive && "hover:-translate-y-0.5 active:translate-y-0 cursor-pointer",
        glow && "hover:shadow-[0_0_24px_rgba(200,160,40,0.06)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);

Card.displayName = "Card";
export default Card;

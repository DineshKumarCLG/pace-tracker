/**
 * PACE Input — Inset-well styled text input.
 *
 * Sizes: sm, md, lg
 * Uses the skeuomorphic inset-well surface for depth.
 */

import { forwardRef } from "react";
import { inputVariants, type InputSize } from "@/lib/variants";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ inputSize = "md", className, ...props }, ref) => (
    <input
      ref={ref}
      className={inputVariants({ size: inputSize, className })}
      {...props}
    />
  ),
);

Input.displayName = "Input";
export default Input;

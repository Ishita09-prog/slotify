import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-lg border border-input bg-background/60 px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";
export { Input };

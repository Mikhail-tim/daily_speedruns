import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

interface GameShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Common card frame shared by every game. */
export const GameShell = forwardRef<HTMLDivElement, GameShellProps>(
  function GameShell({ className, children, ...rest }, ref) {
    return (
      <div ref={ref} className={`game-card ${className ?? ""}`} {...rest}>
        {children}
      </div>
    );
  }
);

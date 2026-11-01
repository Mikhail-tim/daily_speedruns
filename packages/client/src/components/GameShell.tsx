import { forwardRef, useEffect, type HTMLAttributes, type ReactNode } from "react";
import { lockGameScroll } from "../lib/keyboard.js";

interface GameShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Common card frame shared by every game. */
export const GameShell = forwardRef<HTMLDivElement, GameShellProps>(
  function GameShell({ className, children, ...rest }, ref) {
    // Keep Space and the arrows from scrolling the page while a board is up.
    useEffect(() => lockGameScroll(), []);

    return (
      <div ref={ref} className={`game-card ${className ?? ""}`} {...rest}>
        {children}
      </div>
    );
  }
);

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface B2SectionTargets {
  setup: string;
  forecastRisk: string;
  constraints: string;
  results: string;
}

function findTarget(target?: string): HTMLElement | null {
  if (!target || typeof document === "undefined") return null;
  return document.getElementById(target) ??
    (() => {
      try {
        return document.querySelector<HTMLElement>(target);
      } catch {
        return null;
      }
    })();
}

/** Move one rendered control group into an existing shell anchor without cloning its controller. */
export function SectionTargetPortal({ target, children }: { target?: string; children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setElement(findTarget(target));
  }, [target]);

  return element ? createPortal(children, element) : children;
}
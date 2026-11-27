import { useEffect, useState } from "react";

/**
 * The part of the screen a phone's keyboard leaves free, while the keyboard is up; `null` when it
 * is not. Browsers keep laying the page out as if the keyboard were not there and only move what is
 * visible, so a panel fixed to the bottom ends up under the keys: a full-screen view takes this box
 * instead (top and height, in CSS px) while someone types.
 */
export function useKeyboard(): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      // Pinching the whole page also shrinks what is visible: only a view at its own size counts.
      const up = Math.abs(vv.scale - 1) < 0.01 && window.innerHeight - vv.height > 140;
      const top = Math.round(vv.offsetTop), height = Math.round(vv.height);
      setBox((b) => (!up ? null : b && b.top === top && b.height === height ? b : { top, height }));
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => { vv.removeEventListener("resize", sync); vv.removeEventListener("scroll", sync); };
  }, []);
  return box;
}

/** A screen worked with a finger: no hover, and focusing a field brings up the keyboard. */
export const touchScreen = () => window.matchMedia("(pointer: coarse)").matches;

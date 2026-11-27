import { useEffect } from "react";

/** Without a touch, a key or a scroll for this long, nobody is reading: the screen may sleep again. */
const IDLE_MS = 10 * 60_000;

interface Lock { released: boolean; release(): Promise<void> }
type Locks = { request(type: "screen"): Promise<Lock> };

/**
 * Keeps the screen on while `on`: a phone dims and locks after a minute without a touch, and a page
 * of a book takes longer than that to read. The browser lets go of it whenever the page is hidden,
 * so it is asked for again when the page comes back, and it is given up after ten minutes with no
 * sign of a reader, so a phone left open on a table still goes to sleep. Where the browser cannot
 * (an old one, or plain http on the LAN) nothing happens.
 */
export function useAwake(on: boolean): void {
  useEffect(() => {
    const locks = (navigator as Navigator & { wakeLock?: Locks }).wakeLock;
    if (!on || !locks) return;
    let lock: Lock | null = null;
    let asking = false;
    let over = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    const drop = () => {
      const l = lock;
      lock = null;
      if (l && !l.released) void l.release().catch(() => undefined);
    };
    const take = () => {
      if (over || asking || (lock && !lock.released) || document.visibilityState !== "visible") return;
      asking = true;
      locks.request("screen")
        .then((l) => { if (over) void l.release().catch(() => undefined); else lock = l; })
        .catch(() => undefined)   // battery saver, or the page lost the screen meanwhile
        .finally(() => { asking = false; });
    };
    const active = () => {
      // Scrolling says so sixty times a second: once every few is enough to know someone is there.
      const now = Date.now();
      if (now - last < 4000 && lock && !lock.released) return;
      last = now;
      clearTimeout(idle);
      idle = setTimeout(drop, IDLE_MS);
      take();
    };
    const seen = () => { if (document.visibilityState === "visible") active(); };
    const signs = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const s of signs) window.addEventListener(s, active, { capture: true, passive: true });
    document.addEventListener("visibilitychange", seen);
    active();
    return () => {
      over = true;
      clearTimeout(idle);
      for (const s of signs) window.removeEventListener(s, active, { capture: true });
      document.removeEventListener("visibilitychange", seen);
      drop();
    };
  }, [on]);
}

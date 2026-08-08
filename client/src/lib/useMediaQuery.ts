/**
 * Media queries as state, for the handful of cases CSS cannot cover — where
 * the *number of things rendered* has to change, not just their appearance.
 */

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `lg`. Below this the shell switches to drawer + bottom nav. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/** Tailwind's `sm`. Below this, dense readouts thin themselves out. */
export const useIsNarrow = () => useMediaQuery("(max-width: 639px)");

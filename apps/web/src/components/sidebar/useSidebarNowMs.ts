import { useEffect, useState } from "react";

/** Local wall-clock ticker for Working elapsed labels. Does not write to stores. */
export function useSidebarNowMs(intervalMs = 1000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return nowMs;
}

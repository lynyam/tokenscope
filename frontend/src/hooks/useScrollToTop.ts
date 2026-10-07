import { useLayoutEffect } from "react";

export function useScrollToTop() {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);
}
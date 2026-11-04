import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** The Mac app calls this when a reminder is clicked (main.swift, notification delegate). */
export const NATIVE_NAVIGATE = "esmeworldNavigate";

/**
 * Lets the Mac app open a page without reloading the app: `window.esmeworldNavigate("/today")`
 * returns true when it went there. Only app paths ("/…", never "//…") are followed.
 */
export function useNativeNavigate(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const go = (path: unknown): boolean => {
      if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return false;
      navigate(path);
      return true;
    };
    w[NATIVE_NAVIGATE] = go;
    return () => {
      if (w[NATIVE_NAVIGATE] === go) delete w[NATIVE_NAVIGATE];
    };
  }, [navigate]);
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Where the node's API lives.
 *
 * In production the static bundle is served by the node itself, so the API is
 * same-origin and relative paths just work. In dev the frontend runs on its own
 * port, so point at the node directly. An explicit NEXT_PUBLIC_API_URL always
 * wins — set it if you host the UI separately from the node.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:8787");

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Poll an API endpoint on an interval. Returns the last good value; a dropped
 * relay flips `offline` instead of blanking the UI.
 */
export function usePoll<T>(path: string, intervalMs = 4000): { data: T | null; offline: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [offline, setOffline] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const value = await getJson<T>(pathRef.current);
        if (alive) {
          setData(value);
          setOffline(false);
        }
      } catch {
        if (alive) setOffline(true);
      }
    };
    void load();
    const id = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs, path]);

  return { data, offline };
}

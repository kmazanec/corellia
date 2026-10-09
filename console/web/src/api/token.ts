/**
 * The operator token, held in this browser only. Storage can be unavailable
 * (private windows, blocked site data), so every access is guarded and the
 * console simply asks again.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'corellia.operator-token';
const listeners = new Set<() => void>();
let memory: string | null = read();

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  memory = token;
  try {
    if (token === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, token);
  } catch {
    /* in-memory only */
  }
  for (const fn of listeners) fn();
}

export function getToken(): string | null {
  return memory;
}

export function useToken(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => memory,
  );
}

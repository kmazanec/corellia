/**
 * The typed control-plane client. `hc<AppType>` derives every request and
 * response type from the server's route declarations (ADR-050), so the web app
 * and the API cannot drift silently.
 */

import { hc } from 'hono/client';

import type { AppType } from '../factory';
import { getToken, setToken } from './token';

export class Unauthorized extends Error {}

export const api = hc<AppType>('/', {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const token = getToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    const res = await fetch(input, { ...init, headers });
    if (res.status === 401) {
      setToken(null);
      throw new Unauthorized('operator token rejected');
    }
    return res;
  },
}).api;

/** Parse a JSON response, turning non-2xx into an error the query layer shows. */
export async function json<T>(res: { ok: boolean; status: number; json(): Promise<T> }): Promise<T> {
  if (!res.ok) throw new Error(`control plane answered ${res.status}`);
  return res.json();
}

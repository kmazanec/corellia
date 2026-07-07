/**
 * Front-door HTTP server: the three-route webhook surface for the daemon.
 *
 * Routes (ADR-026):
 *   POST /intents           — commission a new intent
 *   POST /intents/:id/answer — answer a parked intent
 *   GET  /status            — project FrontDoorStatus
 *
 * Auth: every request must carry a Bearer token matching FRONT_DOOR_TOKEN.
 * Missing or wrong token → 401; no state change on auth failure.
 *
 * Built on node:http (zero runtime deps beyond pg). TLS is owned by the
 * host's reverse proxy; this process binds plain HTTP.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { Listener } from '../listener/listener.js';
import type { CommissionInput, FrontDoorStatus } from '../contract/brief.js';
import type { Budget } from '../contract/goal.js';

// ── JSON body reader ────────────────────────────────────────────────────────

/**
 * Buffer the full request body and parse it as JSON. Rejects on parse failure
 * or if the body exceeds MAX_BODY_BYTES (defence against payload floods).
 */
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;

    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

// ── Response helpers ─────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

// ── CommissionInput validation ────────────────────────────────────────────────

/**
 * Validate that `v` is a well-formed Budget: an object with finite numeric
 * `attempts`, `tokens`, `toolCalls`, and `wallClockMs` fields.
 */
function isValidBudget(v: unknown): v is Budget {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b['attempts'] === 'number' && isFinite(b['attempts']) &&
    typeof b['tokens'] === 'number' && isFinite(b['tokens']) &&
    typeof b['toolCalls'] === 'number' && isFinite(b['toolCalls']) &&
    typeof b['wallClockMs'] === 'number' && isFinite(b['wallClockMs'])
  );
}

/**
 * Validate that `v` is a string[].
 */
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

/**
 * Validate a raw body object as a CommissionInput. Returns an error message
 * string if invalid, or null if valid.
 */
function validateCommissionInput(body: Record<string, unknown>): string | null {
  if (!isStringArray(body['scope'])) {
    return 'Invalid CommissionInput: "scope" must be a string[]';
  }
  if (!isValidBudget(body['budget'])) {
    return 'Invalid CommissionInput: "budget" must be an object with finite numeric fields: attempts, tokens, toolCalls, wallClockMs';
  }
  return null;
}

// ── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Return true when the request carries a Bearer token that matches `token`.
 * Constant-time string comparison is unnecessary here (single-operator v1),
 * but we reject on exact match only — no partial.
 */
function isAuthorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return false;
  const parts = header.split(' ');
  return parts[0] === 'Bearer' && parts[1] === token;
}

// ── Route matching ────────────────────────────────────────────────────────────

interface ParsedRoute {
  method: string;
  path: string;
  intentId: string | undefined;
  isAnswer: boolean;
}

function parseRoute(req: IncomingMessage): ParsedRoute {
  const method = req.method ?? '';
  const url = req.url ?? '/';
  // Strip query string
  const path = url.split('?')[0] ?? '/';

  // POST /intents/:id/answer
  const answerMatch = /^\/intents\/([^/]+)\/answer$/.exec(path);
  if (answerMatch) {
    return { method, path, intentId: answerMatch[1], isAnswer: true };
  }

  // POST /intents  or  GET /status
  return { method, path, intentId: undefined, isAnswer: false };
}

// ── FrontDoorStatus projection ────────────────────────────────────────────────

/**
 * Map listener.status() to the FrontDoorStatus contract shape.
 *
 * The listener's parked entries carry `id` (not `intentId`) — adapter maps here
 * rather than changing the listener's internal naming.
 */
function projectStatus(listener: Listener): FrontDoorStatus {
  const s = listener.status();
  const status: FrontDoorStatus = {
    running: s.running,
    queued: s.queued,
    parked: s.parked.map((p) => ({
      intentId: p.id,
      question: p.question,
      deadline: p.deadline,
    })),
  };
  // Include parkedImprovement only when non-empty so the payload stays terse
  // for product-only setups (ADR-027: visible in GET /status per AC 4).
  if (s.parkedImprovement.length > 0) {
    status.parkedImprovement = s.parkedImprovement;
  }
  // Surface the USD envelope's consumed/remaining when an envelope is configured.
  if (s.improvementEnvelope !== undefined) {
    status.improvementEnvelope = s.improvementEnvelope;
  }
  return status;
}

// ── FrontDoorServer ───────────────────────────────────────────────────────────

export interface FrontDoorServerOptions {
  listener: Listener;
  /** Bearer token from FRONT_DOOR_TOKEN env. Required. */
  token: string;
  /** TCP port. Pass 0 for an ephemeral port (useful in tests). */
  port?: number;
  /** Hostname to bind (default: '0.0.0.0'). */
  host?: string;
}

export class FrontDoorServer {
  readonly #listener: Listener;
  readonly #token: string;
  readonly #server: Server;

  constructor(opts: FrontDoorServerOptions) {
    this.#listener = opts.listener;
    this.#token = opts.token;
    this.#server = createServer((req, res) => void this.#handle(req, res));
  }

  /** Start listening. Resolves once the server is bound and ready. */
  listen(port = 0, host = '0.0.0.0'): Promise<void> {
    return new Promise((resolve) => {
      this.#server.listen(port, host, () => resolve());
    });
  }

  /**
   * The bound port (useful when listening on 0 to discover the ephemeral port).
   * Only valid after listen() resolves.
   */
  get port(): number {
    const addr = this.#server.address();
    if (addr === null || typeof addr === 'string') return 0;
    return addr.port;
  }

  /** Stop accepting new connections. Existing connections finish first. */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // ── Request dispatch ────────────────────────────────────────────────────────

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Auth gate: every route requires a valid bearer token.
    if (!isAuthorized(req, this.#token)) {
      sendError(res, 401, 'Unauthorized');
      return;
    }

    const route = parseRoute(req);

    // GET /status
    if (route.method === 'GET' && route.path === '/status') {
      sendJson(res, 200, projectStatus(this.#listener));
      return;
    }

    // POST /intents
    if (route.method === 'POST' && route.path === '/intents') {
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'Bad request');
        return;
      }

      // Shape guard — we need at least id + title + spec + scope + budget,
      // with scope as a string[] and budget as a valid finite-numeric Budget.
      if (
        body === null ||
        typeof body !== 'object' ||
        !('id' in body) ||
        !('title' in body) ||
        !('spec' in body) ||
        !('scope' in body) ||
        !('budget' in body)
      ) {
        sendError(res, 422, 'Missing required CommissionInput fields');
        return;
      }

      const bodyObj = body as Record<string, unknown>;
      const validationError = validateCommissionInput(bodyObj);
      if (validationError !== null) {
        sendError(res, 422, validationError);
        return;
      }

      const input = body as CommissionInput;

      // Commission is fire-and-forget from the HTTP response perspective:
      // we return the intent id immediately and let the tree run in the background.
      this.#listener.commission(input).then(
        (_report) => {
          // Tree completed — nothing to do here; clients poll /status.
        },
        (_err) => {
          // Tree errored — surfaced via events; nothing to do in the HTTP layer.
        },
      );

      sendJson(res, 202, { id: input.id });
      return;
    }

    // POST /intents/:id/answer
    if (route.method === 'POST' && route.isAnswer && route.intentId !== undefined) {
      const { intentId } = route;
      let body: unknown;
      try {
        body = await readJson(req);
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'Bad request');
        return;
      }

      if (
        body === null ||
        typeof body !== 'object' ||
        !('answer' in body) ||
        typeof (body as Record<string, unknown>)['answer'] !== 'string'
      ) {
        sendError(res, 422, 'Missing required field: answer (string)');
        return;
      }

      const humanAnswer = (body as { answer: string }).answer;

      // Validate the intent is parked by checking status() before calling answer().
      // answer() returns a rejected Promise on unknown id; we gate on status first
      // so we can fire-and-forget the resume run and respond immediately.
      const currentStatus = this.#listener.status();
      const isParked = currentStatus.parked.some((p) => p.id === intentId);
      if (!isParked) {
        sendError(res, 404, `No parked intent with id "${intentId}"`);
        return;
      }

      // Intent is parked — call answer() and fire-and-forget the resumed run.
      this.#listener.answer(intentId, humanAnswer).then(
        () => {},
        () => {},
      );

      sendJson(res, 202, { intentId, status: 'resumed' });
      return;
    }

    // No route matched
    sendError(res, 404, 'Not found');
  }
}

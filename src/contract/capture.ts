/**
 * Runtime/visual capture — the third acceptance-check modality (ADR-042).
 *
 * A capture reproduces runtime output a script runner cannot reduce to an exit
 * code: a rendered document, a screenshot of a running UI, or a driven endpoint's
 * response. Captures are DECLARED up front (parallel to declaredScripts, ADR-016):
 * the model selects one by name when authoring a criterion; it never supplies a
 * free-form address, path, or command. Every parameter of a CaptureDef is fixed
 * at config time by the operator — the model's only degree of freedom is the name.
 *
 * This module is part of the frozen contract barrier (ADR-002): the shapes live
 * here so the library (checks, criteria), the engine (assembly), and the brains
 * all read one definition.
 */

/**
 * A declared capture. Each kind names a fixed set of declared parameters; none is
 * a model-supplied free-form value. The start/render scripts are declared-script
 * NAMES (reusing the ADR-016 discipline), never shell text.
 */
export type CaptureDef =
  | RenderDocumentCapture
  | ScreenshotUiCapture
  | DriveEndpointCapture;

/**
 * Render a worktree file (PDF, HTML, …) to an image via a declared render script.
 * The script reads `file` and writes an image; the image is the captured output.
 */
export interface RenderDocumentCapture {
  kind: 'render-document';
  /** Worktree-relative path of the document to render; must be in the goal's scope. */
  file: string;
  /** A declared-script name that renders `file` to an image at `outputPath`. */
  renderScript: string;
  /** Worktree-relative path the render script writes the image to. */
  outputPath: string;
  /** Wall-clock bound for the render, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Capture a screenshot of a running UI at a route. Two modes fix WHO takes the
 * screenshot, so a repo that ships a screenshot script keeps precedence and a repo
 * that ships none still gets a built-in floor (ADR-042, ADR-048):
 *
 * - `script` (default) — the declared `startScript` both starts the server AND
 *   writes the screenshot to `outputPath`. This is the original path; the repo
 *   owns the browser dependency. Absent `screenshotMode`, this is the behavior,
 *   so every existing declaration is byte-identical.
 * - `built-in` — the factory drives a headless browser itself. The server comes
 *   from `startScript` (a plain serve command that stays running) or, when
 *   `startScript` is omitted, a built-in static file server rooted at `staticDir`.
 *   The built-in browser is an optional runtime dependency; when it is absent the
 *   capture fails with a clear reason and the `script` path is unaffected.
 */
export interface ScreenshotUiCapture {
  kind: 'screenshot-ui';
  /**
   * A declared-script name that starts the server. Required in `script` mode
   * (it also writes the screenshot). In `built-in` mode it is a plain serve
   * command; omit it to serve `staticDir` with the built-in static server.
   */
  startScript?: string;
  /**
   * Who takes the screenshot. `script` (default) delegates to `startScript`;
   * `built-in` drives the factory's headless browser.
   */
  screenshotMode?: 'script' | 'built-in';
  /**
   * Worktree-relative directory the built-in static server serves when
   * `built-in` mode is used with no `startScript` (a plain-HTML repo). Ignored in
   * `script` mode and when `startScript` is present.
   */
  staticDir?: string;
  /**
   * The localhost port the server binds. Required in `script` mode and in
   * `built-in` mode with a `startScript`. Ignored for the built-in static server,
   * which binds an OS-assigned free port.
   */
  port?: number;
  /** The path to navigate to (e.g. "/"). */
  route: string;
  /** Worktree-relative path the screenshot is written to. */
  outputPath: string;
  /** Extra settle time after page load before the built-in shot, in ms (default 0). */
  waitForMs?: number;
  /** Wall-clock bound for the whole capture, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Start a server via a declared script, wait for readiness, issue one HTTP request
 * to a localhost route, and capture the response body as the captured output.
 */
export interface DriveEndpointCapture {
  kind: 'drive-endpoint';
  /** A declared-script name that starts the server. */
  startScript: string;
  /** The localhost port the server binds. */
  port: number;
  /** The HTTP method to issue. */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  /** The request path (e.g. "/api/health"). */
  path: string;
  /** Worktree-relative path the response body is written to. */
  outputPath: string;
  /** Wall-clock bound for the whole capture, in milliseconds. */
  timeoutMs?: number;
}

/** A name → capture-definition map, authored at config time by the operator. */
export type DeclaredCaptures = Record<string, CaptureDef>;

/**
 * The outcome of running a declared capture. `ok` is the deterministic floor: a
 * capture that did not produce non-empty output is `ok: false`, and a criterion
 * naming it cannot pass regardless of any judge.
 */
export interface CaptureResult {
  /** Whether the capture succeeded and produced non-empty output. */
  ok: boolean;
  /** The capture kind that ran. */
  kind: CaptureDef['kind'];
  /** Worktree-relative path to the captured image or response, when produced. */
  outputRef?: string;
  /** Human-readable detail — the failure reason, or a success summary. */
  detail: string;
  /** Wall-clock duration of the capture, in milliseconds. */
  durationMs: number;
}

/** Run a declared capture by name, returning its deterministic result. */
export type CaptureRunner = (name: string) => Promise<CaptureResult>;

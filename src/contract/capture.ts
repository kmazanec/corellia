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
 * Start a server via a declared script, wait for a localhost port, navigate to a
 * route, and capture a screenshot. The screenshot is the captured output.
 */
export interface ScreenshotUiCapture {
  kind: 'screenshot-ui';
  /** A declared-script name that starts the server. */
  startScript: string;
  /** The localhost port the server binds. */
  port: number;
  /** The path to navigate to (e.g. "/"). */
  route: string;
  /** Worktree-relative path the screenshot is written to. */
  outputPath: string;
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

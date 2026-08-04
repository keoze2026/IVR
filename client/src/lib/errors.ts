/**
 * One error path.
 *
 * The backend guarantees a single envelope:
 *
 *   {"error": {"code", "message", "detail", "request_id"}}
 *
 * with one trap: on a 400 field error, `code` is "invalid" and `message` is a
 * *stringified Python dict* —
 *
 *   "{'name': [ErrorDetail(string='This field is required.', code='required')]}"
 *
 * — while the usable field map is in `detail`. So `message` is never rendered
 * for a 400. See docs/API-GAPS.md G-18.
 *
 * Four endpoints (dnc/check, consent/lookup, contact-lists/{id}/ingest,
 * calls/{id}/recording) emit a narrower {code, message} with no detail or
 * request_id, so every field here is optional. See G-19.
 */

export type FieldErrors = Record<string, string[]>;

export interface ApiErrorBody {
  code?: string;
  message?: string;
  detail?: unknown;
  request_id?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: unknown;
  readonly requestId: string | undefined;
  readonly fieldErrors: FieldErrors | undefined;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    const fieldErrors = extractFieldErrors(body);
    super(humanMessage(body, fieldErrors, fallback));
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code ?? inferCode(status);
    this.detail = body?.detail;
    this.requestId = body?.request_id;
    this.fieldErrors = fieldErrors;
  }

  /** Warnings-only launch: 422 with the full preflight result in `detail`. */
  get isComplianceBlock(): boolean {
    return this.status === 422 && this.code === "compliance_blocked";
  }

  get isStateConflict(): boolean {
    return this.status === 409;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Publish rejection: the validation report is in `detail`. */
  get isInvalidFlow(): boolean {
    return this.code === "invalid_flow";
  }

  messageFor(field: string): string | undefined {
    return this.fieldErrors?.[field]?.[0];
  }
}

function inferCode(status: number): string {
  if (status === 401) return "not_authenticated";
  if (status === 403) return "permission_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "throttled";
  return "error";
}

/**
 * DRF's field-error map, normalised to `{field: string[]}`.
 *
 * Nested serializers produce nested objects; those are flattened to dotted
 * paths so a form can look up "destination" or "prompt.text" the same way.
 */
function extractFieldErrors(body: ApiErrorBody | null): FieldErrors | undefined {
  if (!body || body.code !== "invalid") return undefined;
  const detail = body.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return undefined;

  const out: FieldErrors = {};
  flatten(detail as Record<string, unknown>, "", out);
  return Object.keys(out).length > 0 ? out : undefined;
}

function flatten(source: Record<string, unknown>, prefix: string, out: FieldErrors) {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      const messages = value.filter((v): v is string => typeof v === "string");
      if (messages.length > 0) out[path] = messages;
    } else if (typeof value === "string") {
      out[path] = [value];
    } else if (value && typeof value === "object") {
      flatten(value as Record<string, unknown>, path, out);
    }
  }
}

/**
 * Something a person can read.
 *
 * Priority: the first field error (most specific), then `message` when it is
 * not the stringified-dict artefact, then a status-shaped fallback.
 */
function humanMessage(
  body: ApiErrorBody | null,
  fieldErrors: FieldErrors | undefined,
  fallback: string,
): string {
  if (fieldErrors) {
    const [field, messages] = Object.entries(fieldErrors)[0] ?? [];
    if (field && messages?.[0]) {
      return field === "non_field_errors" ? messages[0] : `${field}: ${messages[0]}`;
    }
  }
  const message = body?.message;
  if (message && !looksLikePythonDict(message)) return message;
  return fallback;
}

function looksLikePythonDict(value: string): boolean {
  return /^\{.*\}$/s.test(value.trim()) || value.includes("ErrorDetail(");
}

/** Non-HTTP failures — DNS, offline, aborted. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Could not reach the server.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

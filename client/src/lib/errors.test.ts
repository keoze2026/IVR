/**
 * The error envelope has one shape and one trap. These pin the trap.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";

describe("ApiError", () => {
  it("never renders the stringified Python dict a 400 puts in `message`", () => {
    const error = new ApiError(
      400,
      {
        code: "invalid",
        // What DRF actually emits through apps/common/exceptions.py.
        message:
          "{'name': [ErrorDetail(string='This field is required.', code='required')]}",
        detail: { name: ["This field is required."] },
        request_id: "abc123",
      },
      "The request failed.",
    );

    expect(error.message).not.toContain("ErrorDetail");
    expect(error.message).not.toContain("{'");
    expect(error.message).toBe("name: This field is required.");
    expect(error.fieldErrors).toEqual({ name: ["This field is required."] });
    expect(error.messageFor("name")).toBe("This field is required.");
    expect(error.requestId).toBe("abc123");
  });

  it("uses `message` when it is genuinely human", () => {
    const error = new ApiError(
      409,
      {
        code: "invalid_state_transition",
        message: "Cannot start a campaign in state 'completed'.",
        detail: null,
      },
      "fallback",
    );
    expect(error.message).toBe("Cannot start a campaign in state 'completed'.");
    expect(error.isStateConflict).toBe(true);
    expect(error.fieldErrors).toBeUndefined();
  });

  it("flattens nested serializer errors to dotted paths", () => {
    const error = new ApiError(
      400,
      {
        code: "invalid",
        message: "{}",
        detail: { destination: { uri: ["Must be a sip: URI."] } },
      },
      "fallback",
    );
    expect(error.fieldErrors).toEqual({ "destination.uri": ["Must be a sip: URI."] });
  });

  it("drops the field prefix for non_field_errors", () => {
    const error = new ApiError(
      400,
      {
        code: "invalid",
        message: "{}",
        detail: { non_field_errors: ["Windows may only tighten the ceiling."] },
      },
      "fallback",
    );
    expect(error.message).toBe("Windows may only tighten the ceiling.");
  });

  it("recognises a warnings-only launch as a compliance block", () => {
    const preflight = {
      ok: true,
      errors: [],
      warnings: [{ code: "attestation_below_a", message: "Caller ID signs B." }],
      estimate: { total: 100, reachable: 98, suppressed: 2 },
      message: "Launch has warnings; resubmit with force=true to acknowledge.",
    };
    const error = new ApiError(
      422,
      { code: "compliance_blocked", message: "Blocked.", detail: preflight },
      "fallback",
    );

    expect(error.isComplianceBlock).toBe(true);
    expect(error.detail).toEqual(preflight);
  });

  it("tolerates the narrow envelope four endpoints emit", () => {
    // dnc/check, consent/lookup, ingest, recording — no detail, no request_id.
    const error = new ApiError(
      410,
      { code: "recording_purged", message: "Deleted under the retention policy." },
      "fallback",
    );
    expect(error.code).toBe("recording_purged");
    expect(error.message).toBe("Deleted under the retention policy.");
    expect(error.requestId).toBeUndefined();
  });

  it("infers a code when the body is missing entirely", () => {
    const error = new ApiError(403, null, "Your role does not permit this action.");
    expect(error.code).toBe("permission_denied");
    expect(error.isForbidden).toBe(true);
    expect(error.message).toBe("Your role does not permit this action.");
  });
});

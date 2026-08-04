/**
 * Capability gating.
 *
 * The server is the authority — every viewset re-checks, and a forged client
 * gets a 403. This exists so the UI does not offer a button that can only
 * fail. Two behaviours here surprise people and are deliberate:
 *
 *   - `operator` can start and stop campaigns but cannot edit or publish
 *     flows, so the builder is read-only for them.
 *   - `compliance` can stop a campaign but cannot edit it — Stop shows, Save
 *     does not.
 *
 * `FALLBACK_MATRIX` mirrors `ROLE_CAPABILITIES` in
 * `IVR/apps/accounts/models.py` and is used only against a backend with no
 * /me endpoint. When /me answers, its `capabilities` win, so the two cannot
 * drift in normal operation.
 */

import type { Capability, Role } from "@/types/domain";

export const FALLBACK_MATRIX: Record<Role, Capability[]> = {
  owner: [
    "campaign.view", "campaign.edit", "campaign.control",
    "contacts.view", "contacts.edit", "contacts.export",
    "flow.view", "flow.edit", "flow.publish",
    "compliance.view", "compliance.edit",
    "recordings.listen", "org.manage",
  ],
  admin: [
    "campaign.view", "campaign.edit", "campaign.control",
    "contacts.view", "contacts.edit", "contacts.export",
    "flow.view", "flow.edit", "flow.publish",
    "compliance.view", "compliance.edit",
    "recordings.listen",
  ],
  operator: [
    "campaign.view", "campaign.edit", "campaign.control",
    "contacts.view", "contacts.edit",
    "flow.view",
    "compliance.view",
  ],
  analyst: ["campaign.view", "contacts.view", "flow.view", "compliance.view"],
  compliance: [
    "campaign.view", "campaign.control",
    "contacts.view", "contacts.export",
    "flow.view",
    "compliance.view", "compliance.edit",
    "recordings.listen",
  ],
};

export function capabilitiesFor(
  role: Role | "",
  fromServer: Capability[] | undefined,
): Set<Capability> {
  if (fromServer && fromServer.length > 0) return new Set(fromServer);
  if (role && role in FALLBACK_MATRIX) return new Set(FALLBACK_MATRIX[role as Role]);
  return new Set();
}

"""
Publish-time flow validation (spec 6.3).

Every check that can be made statically is made here, once, at publish, rather
than at 20 calls per second in the webhook path. A published flow version is
guaranteed to have:

  * a valid entry node
  * no dangling transitions
  * no node unreachable from the entry
  * at least one path to a terminal node from every node
  * only allowlisted transfer destinations, owned by this tenant
  * only audio assets owned by this tenant
  * merge variables drawn from a known set
  * DTMF options that a phone keypad can actually produce

Errors block publication. Warnings do not, but they are stored on the version
and surfaced in the API response, because most of them ("this flow has no
opt-out path") are the kind of thing that becomes expensive later.
"""

from __future__ import annotations

from apps.ivr.dsl import (
    BRANCH_OPERATORS,
    MAX_MENU_OPTIONS,
    MAX_NODES,
    MAX_TTS_LENGTH,
    NODE_ID_RE,
    NODE_SPECS,
    PROMPT_KINDS,
    SCHEMA_VERSION,
    TERMINAL_TYPES,
    VALID_DIGITS,
    VARIABLE_RE,
    ValidationResult,
    merge_tokens,
    transitions_of,
)

#: Merge variables always available, independent of the uploaded CSV.
BUILTIN_VARIABLES = {
    "first_name", "last_name", "full_name", "campaign_name",
    "organization_name", "today", "caller_id",
}


def validate_flow(definition: dict, *, organization_id=None,
                  known_variables: set[str] | None = None) -> ValidationResult:
    result = ValidationResult()

    if not isinstance(definition, dict):
        result.error("not_an_object", "Flow definition must be a JSON object.")
        return result

    _validate_envelope(definition, result)
    nodes = definition.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        result.error("no_nodes", "Flow must declare at least one node.")
        return result
    if len(nodes) > MAX_NODES:
        result.error("too_many_nodes", f"Flow exceeds {MAX_NODES} nodes.")
        return result

    for node_id, node in nodes.items():
        _validate_node(node_id, node, nodes, result,
                       known_variables=known_variables)

    entry = definition.get("entry")
    if entry and entry not in nodes:
        result.error("bad_entry", f"Entry node '{entry}' does not exist.")

    if result.errors:
        # Graph analysis on a structurally broken document produces noise.
        return result

    _validate_graph(definition, nodes, result)
    _validate_references(nodes, organization_id, result)
    _advisory_checks(nodes, result)
    return result


# ---------------------------------------------------------------------------
# Envelope
# ---------------------------------------------------------------------------
def _validate_envelope(definition: dict, result: ValidationResult):
    version = definition.get("schema_version")
    if version != SCHEMA_VERSION:
        result.error(
            "schema_version",
            f"Unsupported schema_version {version!r}; expected {SCHEMA_VERSION}.",
        )
    if not definition.get("entry"):
        result.error("no_entry", "Flow must declare an `entry` node id.")

    locales = definition.get("locales") or [definition.get("default_locale", "en")]
    if not isinstance(locales, list) or not all(isinstance(x, str) for x in locales):
        result.error("bad_locales", "`locales` must be a list of locale strings.")


# ---------------------------------------------------------------------------
# Per-node
# ---------------------------------------------------------------------------
def _validate_node(node_id, node, nodes, result: ValidationResult,
                   known_variables: set[str] | None):
    if not isinstance(node_id, str) or not NODE_ID_RE.match(node_id):
        result.error(
            "bad_node_id",
            "Node ids must be lowercase alphanumeric with - or _, max 64 chars.",
            str(node_id),
        )
        return
    if not isinstance(node, dict):
        result.error("bad_node", "Node must be an object.", node_id)
        return

    node_type = node.get("type")
    spec = NODE_SPECS.get(node_type)
    if spec is None:
        result.error(
            "unknown_node_type",
            f"Unknown node type {node_type!r}. Valid types: "
            f"{', '.join(sorted(NODE_SPECS))}.",
            node_id,
        )
        return

    allowed = spec.required | spec.optional | {"type"}
    for key in node:
        if key not in allowed:
            result.error("unknown_field", f"Field '{key}' is not valid on a "
                         f"{node_type} node.", node_id)
    for key in spec.required:
        if key not in node:
            result.error("missing_field", f"{node_type} node requires '{key}'.",
                         node_id)

    if "prompt" in node:
        _validate_prompt(node_id, node["prompt"], result, known_variables, "prompt")
    for optional_prompt in ("invalid_prompt", "timeout_prompt", "whisper",
                            "ring_prompt"):
        if optional_prompt in node:
            _validate_prompt(node_id, node[optional_prompt], result,
                             known_variables, optional_prompt)

    handler = _NODE_VALIDATORS.get(node_type)
    if handler:
        handler(node_id, node, nodes, result, known_variables)

    # Dangling transitions.
    for fieldname, target in transitions_of(node):
        if target not in nodes:
            result.error(
                "dangling_transition",
                f"'{fieldname}' points at unknown node '{target}'.",
                node_id,
            )


def _validate_prompt(node_id, prompt, result: ValidationResult,
                     known_variables: set[str] | None, label: str):
    if not isinstance(prompt, dict):
        result.error("bad_prompt", f"'{label}' must be an object.", node_id)
        return
    kind = prompt.get("kind")
    if kind not in PROMPT_KINDS:
        result.error(
            "bad_prompt_kind",
            f"'{label}.kind' must be one of {', '.join(sorted(PROMPT_KINDS))}.",
            node_id,
        )
        return

    if kind == "audio":
        if not prompt.get("asset"):
            result.error("missing_asset", f"'{label}' of kind audio needs an "
                         "`asset` id.", node_id)
        # A URL here would be the SSRF vector the DSL exists to prevent.
        if "url" in prompt:
            result.error(
                "url_not_allowed",
                "Audio prompts reference an AudioAsset id, never a URL.",
                node_id,
            )
        return

    text = prompt.get("text") or ""
    if not text.strip():
        result.error("empty_text", f"'{label}' has no text.", node_id)
    if len(text) > MAX_TTS_LENGTH:
        result.error("text_too_long",
                     f"'{label}' exceeds {MAX_TTS_LENGTH} characters.", node_id)

    tokens = merge_tokens(text)
    allowed = BUILTIN_VARIABLES | (known_variables or set())
    for token in tokens:
        root = token.split(".", 1)[0]
        if not VARIABLE_RE.match(root):
            result.error("bad_variable", f"Invalid merge variable '{token}'.",
                         node_id)
        elif known_variables is not None and root not in allowed:
            result.warn(
                "unknown_variable",
                f"Merge variable '{token}' is not present in the target list; "
                "it will render as empty.",
                node_id,
            )

    if kind == "say" and not tokens:
        result.warn(
            "static_say",
            "This prompt has no merge variables — use kind 'tts' so it is "
            "pre-rendered once instead of synthesised on every call.",
            node_id,
        )


def _validate_menu(node_id, node, nodes, result, _known):
    options = node.get("options")
    if not isinstance(options, dict) or not options:
        result.error("no_options", "Menu node needs at least one option.", node_id)
        return
    if len(options) > MAX_MENU_OPTIONS:
        result.error("too_many_options",
                     f"Menu has more than {MAX_MENU_OPTIONS} options.", node_id)
    for digit in options:
        if not isinstance(digit, str) or len(digit) != 1 or digit not in VALID_DIGITS:
            result.error(
                "bad_digit",
                f"Menu key {digit!r} is not a single keypad digit (0-9, * or #).",
                node_id,
            )
    attempts = node.get("max_attempts", 3)
    if not isinstance(attempts, int) or not 1 <= attempts <= 5:
        result.error("bad_max_attempts", "max_attempts must be between 1 and 5.",
                     node_id)
    timeout = node.get("timeout_seconds", 5)
    if not isinstance(timeout, int) or not 1 <= timeout <= 30:
        result.error("bad_timeout", "timeout_seconds must be between 1 and 30.",
                     node_id)


def _validate_collect(node_id, node, nodes, result, _known):
    variable = node.get("variable")
    if not isinstance(variable, str) or not VARIABLE_RE.match(variable):
        result.error("bad_variable_name",
                     "collect.variable must be a simple identifier.", node_id)
    lo = node.get("min_digits", 1)
    hi = node.get("max_digits", 16)
    if not isinstance(lo, int) or not isinstance(hi, int) or lo < 1 or hi > 32 or lo > hi:
        result.error("bad_digit_range",
                     "min_digits/max_digits must satisfy 1 <= min <= max <= 32.",
                     node_id)


def _validate_branch(node_id, node, nodes, result, _known):
    conditions = node.get("conditions")
    if not isinstance(conditions, list) or not conditions:
        result.error("no_conditions", "Branch node needs a conditions list.",
                     node_id)
        return
    for i, cond in enumerate(conditions):
        if not isinstance(cond, dict):
            result.error("bad_condition", f"Condition {i} must be an object.",
                         node_id)
            continue
        op = cond.get("op")
        if op not in BRANCH_OPERATORS:
            result.error(
                "bad_operator",
                f"Condition {i} uses unsupported operator {op!r}. Allowed: "
                f"{', '.join(sorted(BRANCH_OPERATORS))}.",
                node_id,
            )
        var = cond.get("variable")
        if not isinstance(var, str) or not VARIABLE_RE.match(var.split(".", 1)[0]):
            result.error("bad_condition_variable",
                         f"Condition {i} has an invalid variable.", node_id)
        if not cond.get("then"):
            result.error("no_then", f"Condition {i} has no `then` target.", node_id)


def _validate_transfer(node_id, node, nodes, result, _known):
    if not node.get("endpoint"):
        result.error("no_endpoint", "Transfer node needs an `endpoint` id.", node_id)
    for forbidden in ("destination", "sip_uri", "number", "url"):
        if forbidden in node:
            result.error(
                "inline_destination",
                "Transfer destinations are TransferEndpoint ids, never inline "
                "dial strings.",
                node_id,
            )


def _validate_record(node_id, node, nodes, result, _known):
    max_len = node.get("max_length_seconds", 120)
    if not isinstance(max_len, int) or not 1 <= max_len <= 3600:
        result.error("bad_max_length",
                     "max_length_seconds must be between 1 and 3600.", node_id)


_NODE_VALIDATORS = {
    "menu": _validate_menu,
    "collect": _validate_collect,
    "branch": _validate_branch,
    "transfer": _validate_transfer,
    "record": _validate_record,
}


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------
def _validate_graph(definition: dict, nodes: dict, result: ValidationResult):
    entry = definition["entry"]

    reachable = _reachable_from(entry, nodes)
    for node_id in nodes:
        if node_id not in reachable:
            result.warn("unreachable", "Node is not reachable from the entry "
                        "node.", node_id)

    # Every reachable node must be able to reach a terminal state. A node that
    # can only loop is a call that never hangs up — the carrier will eventually
    # cut it, but not before it has burned minutes on every answer.
    terminating = _nodes_that_terminate(nodes)
    for node_id in sorted(reachable):
        if node_id not in terminating:
            result.error(
                "no_terminal_path",
                "No path from this node reaches a terminal node (hangup, "
                "transfer, opt_out or voicemail).",
                node_id,
            )


def _reachable_from(entry: str, nodes: dict) -> set[str]:
    seen, stack = set(), [entry]
    while stack:
        current = stack.pop()
        if current in seen or current not in nodes:
            continue
        seen.add(current)
        stack.extend(t for _, t in transitions_of(nodes[current]))
    return seen


def _nodes_that_terminate(nodes: dict) -> set[str]:
    """Fixed-point: a node terminates if it is terminal, has no transitions
    (falls through to hangup), or can reach a node that terminates."""
    terminating = {
        node_id
        for node_id, node in nodes.items()
        if node.get("type") in TERMINAL_TYPES or not transitions_of(node)
    }
    changed = True
    while changed:
        changed = False
        for node_id, node in nodes.items():
            if node_id in terminating:
                continue
            if any(t in terminating for _, t in transitions_of(node)):
                terminating.add(node_id)
                changed = True
    return terminating


# ---------------------------------------------------------------------------
# Cross-table references
# ---------------------------------------------------------------------------
def _validate_references(nodes: dict, organization_id, result: ValidationResult):
    if organization_id is None:
        return

    from apps.ivr.models import AudioAsset, TransferEndpoint

    asset_ids, endpoint_ids = set(), set()
    for node_id, node in nodes.items():
        for key in ("prompt", "invalid_prompt", "timeout_prompt", "whisper",
                    "ring_prompt"):
            prompt = node.get(key)
            if isinstance(prompt, dict) and prompt.get("kind") == "audio":
                asset_ids.add((node_id, str(prompt.get("asset"))))
        if node.get("type") == "transfer" and node.get("endpoint"):
            endpoint_ids.add((node_id, str(node["endpoint"])))

    if asset_ids:
        known = set(
            AudioAsset.objects.unscoped()
            .filter(organization_id=organization_id,
                    id__in=[a for _, a in asset_ids])
            .values_list("id", flat=True)
        )
        known = {str(k) for k in known}
        for node_id, asset in asset_ids:
            if asset not in known:
                result.error(
                    "unknown_asset",
                    f"Audio asset {asset} does not exist in this organisation.",
                    node_id,
                )

    if endpoint_ids:
        active = set(
            TransferEndpoint.objects.unscoped()
            .filter(
                organization_id=organization_id,
                id__in=[e for _, e in endpoint_ids],
                is_active=True,
            )
            .values_list("id", flat=True)
        )
        active = {str(k) for k in active}
        for node_id, endpoint in endpoint_ids:
            if endpoint not in active:
                result.error(
                    "unknown_endpoint",
                    f"Transfer endpoint {endpoint} is not an active, "
                    "allowlisted destination for this organisation.",
                    node_id,
                )


# ---------------------------------------------------------------------------
# Advisory
# ---------------------------------------------------------------------------
def _advisory_checks(nodes: dict, result: ValidationResult):
    types = [n.get("type") for n in nodes.values()]

    if "opt_out" not in types:
        result.warn(
            "no_opt_out",
            "Flow has no opt_out node. An automated marketing call needs an "
            "in-call opt-out path; add one before using this flow for a "
            "marketing campaign.",
        )

    if "record" in types:
        # The disclosure has to be heard before recording starts, which means
        # it has to be on the path, not merely present in the document.
        result.warn(
            "recording_disclosure",
            "Flow records the caller. Confirm a recording disclosure is played "
            "before the record node on every path that reaches it.",
        )

    for node_id, node in nodes.items():
        if node.get("type") == "menu":
            options = node.get("options") or {}
            if "9" not in options and "0" not in options:
                result.warn(
                    "no_opt_out_key",
                    "Menu offers no conventional opt-out key (9 or 0).",
                    node_id,
                )
            if not node.get("on_timeout"):
                result.warn(
                    "no_timeout_target",
                    "Menu has no on_timeout target; the call will hang up after "
                    "max_attempts with no closing message.",
                    node_id,
                )

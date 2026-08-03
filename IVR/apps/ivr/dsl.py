"""
The IVR flow DSL (spec 6.1, 6.2).

A flow is a directed graph of typed nodes stored as one JSONB document. It is
deliberately not a general-purpose scripting language: the node types are
fixed, there is no arbitrary code execution, every transition target is
validated against the node set at publish time, and every outward-facing
reference (audio asset, transfer destination) is an id resolved against a
tenant-owned table rather than a URL. That is what makes flows safe to author
in a visual builder and impossible to turn into an SSRF or toll-fraud vector.

Document shape
--------------

    {
      "schema_version": "1.0",
      "entry": "greeting",
      "default_locale": "en",
      "locales": ["en", "sw"],
      "metadata": {"author": "...", "notes": "..."},
      "nodes": {
        "greeting": {
          "type": "play",
          "prompt": {"kind": "tts", "text": "Hello {{first_name}}."},
          "next": "menu"
        },
        "menu": {
          "type": "menu",
          "prompt": {"kind": "tts", "text": "Press 1 to confirm, 9 to opt out."},
          "options": {"1": "confirm", "2": "agent", "9": "optout"},
          "timeout_seconds": 5,
          "max_attempts": 3,
          "invalid_prompt": {"kind": "tts", "text": "Sorry, I didn't get that."},
          "on_timeout": "goodbye",
          "on_invalid": "goodbye"
        },
        "confirm":  {"type": "play", "prompt": {...}, "next": "goodbye",
                     "disposition": "confirmed"},
        "agent":    {"type": "transfer", "endpoint": "<TransferEndpoint uuid>",
                     "on_fail": "goodbye", "whisper": {...}},
        "optout":   {"type": "opt_out", "prompt": {...}, "scope": "organization"},
        "goodbye":  {"type": "hangup", "prompt": {...}}
      }
    }

Prompt objects
--------------

    {"kind": "audio", "asset": "<AudioAsset uuid>"}      pre-recorded upload
    {"kind": "tts",   "text": "Hello {{first_name}}."}   pre-rendered to S3
    {"kind": "say",   "text": "Your balance is {{balance}}."}
                                                         live <Say>, per-contact

`tts` prompts are rendered once per (flow version, locale) at publish time and
served as <Play> (spec 2.3). `say` exists only for genuinely per-contact
fragments that cannot be pre-rendered; the validator warns when a flow uses it
for text containing no merge variables, because that is a pure waste of latency
and money.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

SCHEMA_VERSION = "1.0"

#: Ceilings. A flow larger than this is a sign the operator is building an
#: application, not a call script, and every node is a round trip of latency.
MAX_NODES = 200
MAX_MENU_OPTIONS = 12
MAX_TTS_LENGTH = 4000
MAX_TRAVERSAL_DEPTH = 60

NODE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
VARIABLE_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$", re.IGNORECASE)
MERGE_TOKEN_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")
VALID_DIGITS = set("0123456789*#")

PROMPT_KINDS = {"audio", "tts", "say"}


@dataclass(frozen=True)
class NodeSpec:
    """Declarative description of a node type, used by the validator, the
    renderer and the API schema so the three cannot drift."""

    type: str
    required: frozenset[str] = frozenset()
    optional: frozenset[str] = frozenset()
    #: Fields whose value is the id of another node.
    transitions: tuple[str, ...] = ()
    #: True when the node ends the call and needs no `next`.
    terminal: bool = False
    #: True when the node waits for DTMF and therefore needs an action URL.
    gathers_input: bool = False
    description: str = ""


COMMON_OPTIONAL = frozenset(
    {
        "label",        # builder-only annotation
        "disposition",  # business outcome recorded when this node is reached
        "tags",
        "barge_in",     # allow DTMF to interrupt the prompt
    }
)


NODE_SPECS: dict[str, NodeSpec] = {
    "play": NodeSpec(
        type="play",
        required=frozenset({"prompt"}),
        optional=COMMON_OPTIONAL | {"next", "loop", "pause_after"},
        transitions=("next",),
        description="Play a prompt, then fall through to `next` (or hang up).",
    ),
    "menu": NodeSpec(
        type="menu",
        required=frozenset({"prompt", "options"}),
        optional=COMMON_OPTIONAL
        | {
            "timeout_seconds", "max_attempts", "invalid_prompt", "timeout_prompt",
            "on_timeout", "on_invalid", "num_digits", "finish_on_key",
        },
        transitions=("on_timeout", "on_invalid"),
        gathers_input=True,
        description="Play a prompt and branch on a single DTMF keypress.",
    ),
    "collect": NodeSpec(
        type="collect",
        required=frozenset({"prompt", "variable", "next"}),
        optional=COMMON_OPTIONAL
        | {
            "min_digits", "max_digits", "timeout_seconds", "finish_on_key",
            "max_attempts", "invalid_prompt", "on_invalid", "on_timeout",
        },
        transitions=("next", "on_invalid", "on_timeout"),
        gathers_input=True,
        description="Collect a multi-digit value into a call variable.",
    ),
    "transfer": NodeSpec(
        type="transfer",
        required=frozenset({"endpoint"}),
        optional=COMMON_OPTIONAL
        | {"whisper", "on_fail", "timeout_seconds", "record", "ring_prompt"},
        transitions=("on_fail",),
        description="Bridge the caller to an allowlisted TransferEndpoint.",
    ),
    "opt_out": NodeSpec(
        type="opt_out",
        required=frozenset({"prompt"}),
        optional=COMMON_OPTIONAL | {"scope", "next"},
        transitions=("next",),
        terminal=True,
        description="Record a suppression for the called number, then confirm.",
    ),
    "voicemail": NodeSpec(
        type="voicemail",
        required=frozenset({"prompt"}),
        optional=COMMON_OPTIONAL | {"max_length_seconds"},
        terminal=True,
        description="Message left when AMD reports a machine (spec 9).",
    ),
    "record": NodeSpec(
        type="record",
        required=frozenset({"prompt"}),
        optional=COMMON_OPTIONAL
        | {"max_length_seconds", "finish_on_key", "next", "play_beep",
           "transcribe"},
        transitions=("next",),
        description="Record the caller. Requires a disclosure node upstream.",
    ),
    "branch": NodeSpec(
        type="branch",
        required=frozenset({"conditions", "default"}),
        optional=COMMON_OPTIONAL,
        transitions=("default",),
        description="Route on a call variable using a fixed operator set.",
    ),
    "hangup": NodeSpec(
        type="hangup",
        required=frozenset(),
        optional=COMMON_OPTIONAL | {"prompt"},
        terminal=True,
        description="End the call, optionally after a final prompt.",
    ),
}

#: The only comparisons a branch node may express. No eval, no regex, no
#: arithmetic — anything richer belongs in the data, not the call script.
BRANCH_OPERATORS = {
    "eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte",
    "starts_with", "is_set", "is_empty",
}

TERMINAL_TYPES = {name for name, spec in NODE_SPECS.items() if spec.terminal}
INPUT_TYPES = {name for name, spec in NODE_SPECS.items() if spec.gathers_input}


@dataclass
class ValidationIssue:
    level: str  # "error" | "warning"
    code: str
    message: str
    node: str = ""

    def as_dict(self) -> dict:
        return {
            "level": self.level,
            "code": self.code,
            "message": self.message,
            "node": self.node,
        }


@dataclass
class ValidationResult:
    issues: list[ValidationIssue] = field(default_factory=list)

    def error(self, code: str, message: str, node: str = ""):
        self.issues.append(ValidationIssue("error", code, message, node))

    def warn(self, code: str, message: str, node: str = ""):
        self.issues.append(ValidationIssue("warning", code, message, node))

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.level == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "errors": [i.as_dict() for i in self.errors],
            "warnings": [i.as_dict() for i in self.warnings],
        }


def merge_tokens(text: str) -> set[str]:
    """Merge variables referenced by a prompt string."""
    return set(MERGE_TOKEN_RE.findall(text or ""))


def transitions_of(node: dict) -> list[tuple[str, str]]:
    """Yield (field, target_node_id) for every transition a node declares."""
    spec = NODE_SPECS.get(node.get("type"))
    if spec is None:
        return []
    out = [
        (fieldname, node[fieldname])
        for fieldname in spec.transitions
        if node.get(fieldname)
    ]
    if node.get("type") == "menu":
        out.extend(
            (f"options.{digit}", target)
            for digit, target in (node.get("options") or {}).items()
        )
    if node.get("type") == "branch":
        out.extend(
            (f"conditions[{i}]", cond.get("then"))
            for i, cond in enumerate(node.get("conditions") or [])
            if cond.get("then")
        )
    return out

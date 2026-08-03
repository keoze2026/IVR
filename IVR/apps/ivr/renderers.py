"""
TwiML / TeXML rendering (spec 8.4).

Twilio and Telnyx speak near-identical XML dialects, which is what makes
dual-carrier failover realistic — but "near-identical" is doing real work in
that sentence. The differences that matter are handled by per-provider
attribute maps rather than by branching inside the flow logic, so the
orchestrator never has to know which carrier it is talking to.

XML is built with explicit escaping rather than string interpolation. Prompt
text can contain contact-supplied merge variables; an unescaped ampersand in a
customer's name is a malformed-TwiML error on a live call, and an unescaped
angle bracket is markup injection into the call script.
"""

from __future__ import annotations

from xml.sax.saxutils import escape, quoteattr

from apps.ivr.runtime import Plan, Verb

XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'


class BaseRenderer:
    """Shared XML emitter."""

    #: Attributes the provider does not understand, dropped per verb.
    unsupported: dict[str, set[str]] = {}
    #: Attribute renames, per verb.
    renames: dict[str, dict[str, str]] = {}

    def render(self, plan: Plan) -> str:
        body = "".join(self._verb(v) for v in plan.verbs)
        return f"{XML_DECLARATION}<Response>{body}</Response>"

    def _verb(self, verb: Verb) -> str:
        attrs = self._attrs(verb)
        rendered_attrs = "".join(
            f" {name}={quoteattr(_stringify(value))}"
            for name, value in attrs.items()
            if value is not None and value != ""
        )
        inner = escape(verb.text) if verb.text else ""
        inner += "".join(self._verb(child) for child in verb.children)
        if not inner:
            return f"<{verb.name}{rendered_attrs}/>"
        return f"<{verb.name}{rendered_attrs}>{inner}</{verb.name}>"

    def _attrs(self, verb: Verb) -> dict:
        drop = self.unsupported.get(verb.name, set())
        rename = self.renames.get(verb.name, {})
        return {
            rename.get(key, key): value
            for key, value in verb.attrs.items()
            if key not in drop
        }


class TwiMLRenderer(BaseRenderer):
    """Twilio Programmable Voice."""


class TeXMLRenderer(BaseRenderer):
    """
    Telnyx TeXML.

    Telnyx implements most of the TwiML verb set. The attributes listed here
    are the ones this platform uses that Telnyx either ignores or rejects; they
    are dropped rather than passed through, because Telnyx errors on unknown
    attributes on some verbs rather than ignoring them.
    """

    unsupported = {
        "Gather": {"actionOnEmptyResult"},
        "Record": {"transcribe"},
    }


_RENDERERS = {
    "twilio": TwiMLRenderer(),
    "telnyx": TeXMLRenderer(),
}


def get_renderer(provider: str) -> BaseRenderer:
    return _RENDERERS.get((provider or "").lower(), _RENDERERS["twilio"])


def render(plan: Plan, provider: str = "twilio") -> str:
    return get_renderer(provider).render(plan)


def _stringify(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


# ---------------------------------------------------------------------------
# Canned responses
#
# These exist for the paths where there is no plan to render: a signature
# failure, a lost call, a campaign stopped mid-flight. Every one of them ends
# the call cleanly rather than leaving the caller in silence.
# ---------------------------------------------------------------------------
def hangup_response(provider: str = "twilio") -> str:
    return render(Plan(verbs=[Verb("Hangup")]), provider)


def reject_response(provider: str = "twilio", reason: str = "rejected") -> str:
    return render(Plan(verbs=[Verb("Reject", {"reason": reason})]), provider)


def say_and_hangup(text: str, provider: str = "twilio",
                   language: str = "en") -> str:
    return render(
        Plan(verbs=[Verb("Say", {"language": language}, text), Verb("Hangup")]),
        provider,
    )


def redirect_response(url: str, provider: str = "twilio") -> str:
    return render(Plan(verbs=[Verb("Redirect", {"method": "POST"}, url)]), provider)

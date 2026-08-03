"""
Flow orchestration and TwiML rendering (spec 6.2, 8.4).

The orchestrator is pure functions over dicts precisely so it can be tested
without a carrier, a database or a Redis instance.
"""

from apps.ivr import renderers, runtime
from apps.ivr.state import CallState


class _OfflineCallState(CallState):
    """
    CallState with persistence disabled.

    Subclassed rather than monkeypatched because CallState defines __slots__ —
    which is deliberate, since one of these is allocated per live call — and
    slotted instances reject attribute assignment.
    """

    __slots__ = ()

    def save(self, ttl=None):
        return self


def make_state(**data):
    return _OfflineCallState(
        "CA-test", {"path": [], "vars": {}, "node_attempts": {}, **data}
    )


def action_url(node_id):
    return f"https://example.test/gather?node={node_id}"


class TestPlanning:
    def test_play_chains_into_the_next_node(self, flow):
        state = make_state()
        plan = runtime.plan_node(flow, "greeting", state, {},
                                 action_url_for=action_url)
        # greeting (Say) → menu (Gather) in one response, not two round trips.
        assert [v.name for v in plan.verbs] == ["Say", "Gather"]
        assert state.path == ["greeting", "menu"]

    def test_hangup_is_terminal(self, flow):
        plan = runtime.plan_node(flow, "goodbye", make_state(), {},
                                 action_url_for=action_url)
        assert plan.terminal
        assert plan.verbs[-1].name == "Hangup"

    def test_opt_out_emits_an_effect(self, flow):
        plan = runtime.plan_node(flow, "optout", make_state(), {},
                                 action_url_for=action_url)
        assert any(e.kind == "opt_out" for e in plan.effects)
        assert plan.terminal

    def test_disposition_on_a_node_is_recorded(self, flow):
        state = make_state()
        runtime.plan_node(flow, "confirm", state, {}, action_url_for=action_url)
        assert state.disposition == "confirmed"

    def test_unknown_node_hangs_up_rather_than_raising(self, flow):
        """A missing node mid-call must end the call cleanly, not 500."""
        plan = runtime.plan_node(flow, "does_not_exist", make_state(), {},
                                 action_url_for=action_url)
        assert plan.verbs[-1].name == "Hangup"


class TestInputHandling:
    def test_matched_digit_routes_to_its_target(self, flow):
        node, outcome = runtime.handle_input(flow, "menu", "1", make_state())
        assert (node, outcome) == ("confirm", "matched")

    def test_invalid_digit_retries_until_max_attempts(self, flow):
        state = make_state()
        node, outcome = runtime.handle_input(flow, "menu", "5", state)
        assert (node, outcome) == ("menu", "retry")
        node, outcome = runtime.handle_input(flow, "menu", "5", state)
        assert node == "goodbye"
        assert outcome == "invalid"

    def test_timeout_uses_the_timeout_target(self, flow):
        state = make_state()
        runtime.handle_input(flow, "menu", "", state)
        node, outcome = runtime.handle_input(flow, "menu", "", state)
        assert node == "goodbye"
        assert outcome == "timeout"

    def test_attempts_are_tracked_per_node(self, flow):
        state = make_state()
        runtime.handle_input(flow, "menu", "5", state)
        assert state.attempts_at("menu") == 1
        assert state.attempts_at("greeting") == 0


class TestMergeRendering:
    def test_substitutes_known_variables(self):
        assert runtime.render_text("Hello {{first_name}}.",
                                   {"first_name": "Ada"}) == "Hello Ada."

    def test_unknown_variable_renders_empty_rather_than_raising(self):
        """A missing merge field must not take a live call down."""
        assert runtime.render_text("Hi {{nope}}!", {}) == "Hi !"

    def test_dotted_access_is_one_level_only(self):
        context = {"account": {"balance": "12"}}
        assert runtime.render_text("{{account.balance}}", context) == "12"


class TestConditions:
    def test_supported_operators(self):
        ctx = {"plan": "gold", "score": "42"}
        assert runtime.evaluate_condition(
            {"variable": "plan", "op": "eq", "value": "gold"}, ctx)
        assert runtime.evaluate_condition(
            {"variable": "score", "op": "gt", "value": 10}, ctx)
        assert runtime.evaluate_condition(
            {"variable": "plan", "op": "in", "value": ["gold", "silver"]}, ctx)

    def test_unsupported_operator_is_false_not_an_exception(self):
        assert runtime.evaluate_condition(
            {"variable": "plan", "op": "exec", "value": "x"}, {"plan": "gold"}
        ) is False

    def test_type_mismatch_is_false_not_an_exception(self):
        assert runtime.evaluate_condition(
            {"variable": "plan", "op": "gt", "value": 10}, {"plan": "gold"}
        ) is False


class TestRendering:
    def test_emits_well_formed_xml(self, flow):
        plan = runtime.plan_node(flow, "greeting", make_state(), {},
                                 action_url_for=action_url)
        xml = renderers.render(plan, "twilio")
        assert xml.startswith('<?xml version="1.0" encoding="UTF-8"?><Response>')
        assert xml.endswith("</Response>")

        import xml.etree.ElementTree as ET

        ET.fromstring(xml.split("?>", 1)[1])  # parses without error

    def test_escapes_contact_supplied_text(self, flow):
        """An unescaped ampersand in a name is malformed TwiML on a live call."""
        plan = runtime.Plan(verbs=[runtime.Verb("Say", {}, "Tom & Jerry <hi>")])
        xml = renderers.render(plan, "twilio")
        assert "&amp;" in xml
        assert "&lt;hi&gt;" in xml
        assert "<hi>" not in xml

    def test_escapes_attribute_values(self):
        """
        An unescaped ampersand in a callback URL is malformed TwiML on a live
        call. What matters is that the document parses and the value survives
        intact — quoteattr may legitimately switch to single quotes rather than
        escaping an embedded double quote, and both are correct XML.
        """
        import xml.etree.ElementTree as ET

        url = 'https://x.test/a?b="c"&d=1'
        plan = runtime.Plan(verbs=[runtime.Verb("Play", {"url": url})])
        xml = renderers.render(plan, "twilio")

        assert "&amp;d=1" in xml
        root = ET.fromstring(xml.split("?>", 1)[1])
        assert root.find("Play").attrib["url"] == url

    def test_telnyx_drops_attributes_it_rejects(self, flow):
        plan = runtime.plan_node(flow, "menu", make_state(), {},
                                 action_url_for=action_url)
        twiml = renderers.render(plan, "twilio")
        texml = renderers.render(plan, "telnyx")
        assert "actionOnEmptyResult" in twiml
        assert "actionOnEmptyResult" not in texml

    def test_booleans_render_lowercase(self):
        plan = runtime.Plan(verbs=[runtime.Verb("Record", {"playBeep": True})])
        assert 'playBeep="true"' in renderers.render(plan, "twilio")

    def test_canned_hangup_response(self):
        assert "<Hangup/>" in renderers.hangup_response("twilio")

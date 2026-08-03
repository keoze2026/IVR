"""
Publish-time flow validation (spec 6.3).

Two classes of test: the graph properties that make a flow safe to execute, and
the injection surfaces the DSL exists to close.
"""

import copy

from apps.ivr.validators import validate_flow


def codes(result, level="errors"):
    return {issue["code"] for issue in result.as_dict()[level]}


class TestValidDocuments:
    def test_the_reference_flow_validates(self, flow_definition):
        result = validate_flow(flow_definition)
        assert result.ok, result.as_dict()

    def test_warnings_do_not_block_publication(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        del definition["nodes"]["optout"]
        definition["nodes"]["menu"]["options"] = {"1": "confirm"}
        result = validate_flow(definition)
        assert result.ok
        assert "no_opt_out" in codes(result, "warnings")


class TestGraphIntegrity:
    def test_dangling_transition_is_an_error(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["menu"]["options"]["1"] = "nowhere"
        assert "dangling_transition" in codes(validate_flow(definition))

    def test_missing_entry_node_is_an_error(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["entry"] = "does_not_exist"
        assert "bad_entry" in codes(validate_flow(definition))

    def test_unreachable_node_is_a_warning_not_an_error(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["orphan"] = {
            "type": "hangup", "prompt": {"kind": "tts", "text": "Bye."}
        }
        result = validate_flow(definition)
        assert result.ok
        assert "unreachable" in codes(result, "warnings")

    def test_cycle_with_no_terminal_path_is_rejected(self):
        """A call that can never hang up bills until the carrier cuts it."""
        definition = {
            "schema_version": "1.0",
            "entry": "a",
            "nodes": {
                "a": {"type": "play", "prompt": {"kind": "tts", "text": "a"},
                      "next": "b"},
                "b": {"type": "play", "prompt": {"kind": "tts", "text": "b"},
                      "next": "a"},
            },
        }
        assert "no_terminal_path" in codes(validate_flow(definition))

    def test_cycle_is_allowed_when_it_can_still_escape(self):
        definition = {
            "schema_version": "1.0",
            "entry": "menu",
            "nodes": {
                "menu": {
                    "type": "menu",
                    "prompt": {"kind": "tts", "text": "Press 1 or 9."},
                    "options": {"1": "menu", "9": "bye"},
                    "on_timeout": "bye",
                },
                "bye": {"type": "hangup"},
            },
        }
        assert validate_flow(definition).ok


class TestInjectionSurfaces:
    def test_audio_prompt_may_not_carry_a_url(self, flow_definition):
        """The SSRF vector the DSL is designed to make unrepresentable."""
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["greeting"]["prompt"] = {
            "kind": "audio",
            "asset": "00000000-0000-0000-0000-000000000000",
            "url": "http://169.254.169.254/latest/meta-data/",
        }
        assert "url_not_allowed" in codes(validate_flow(definition))

    def test_transfer_may_not_carry_an_inline_destination(self, flow_definition):
        """Otherwise flow-edit permission becomes toll-fraud permission."""
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["agent"] = {
            "type": "transfer",
            "endpoint": "00000000-0000-0000-0000-000000000000",
            "destination": "+1900PREMIUM",
        }
        definition["nodes"]["menu"]["options"]["2"] = "agent"
        assert "inline_destination" in codes(validate_flow(definition))

    def test_unknown_node_type_is_rejected(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["evil"] = {"type": "exec", "command": "rm -rf /"}
        assert "unknown_node_type" in codes(validate_flow(definition))

    def test_unknown_field_on_a_known_type_is_rejected(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["greeting"]["callback_url"] = "http://evil.test/"
        assert "unknown_field" in codes(validate_flow(definition))

    def test_branch_operator_set_is_closed(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["router"] = {
            "type": "branch",
            "conditions": [{"variable": "plan", "op": "eval",
                            "value": "__import__('os')", "then": "goodbye"}],
            "default": "goodbye",
        }
        definition["nodes"]["greeting"]["next"] = "router"
        assert "bad_operator" in codes(validate_flow(definition))


class TestNodeConstraints:
    def test_non_keypad_menu_key_is_rejected(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["menu"]["options"]["A"] = "confirm"
        assert "bad_digit" in codes(validate_flow(definition))

    def test_multi_character_menu_key_is_rejected(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["menu"]["options"]["12"] = "confirm"
        assert "bad_digit" in codes(validate_flow(definition))

    def test_collect_digit_range_must_be_sane(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["dob"] = {
            "type": "collect",
            "prompt": {"kind": "tts", "text": "Enter your date of birth."},
            "variable": "dob",
            "min_digits": 9,
            "max_digits": 4,
            "next": "goodbye",
        }
        definition["nodes"]["menu"]["options"]["2"] = "dob"
        assert "bad_digit_range" in codes(validate_flow(definition))

    def test_schema_version_is_enforced(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["schema_version"] = "9.9"
        assert "schema_version" in codes(validate_flow(definition))

    def test_static_say_prompt_is_flagged_as_wasteful(self, flow_definition):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["greeting"]["prompt"] = {
            "kind": "say", "text": "Hello there."
        }
        assert "static_say" in codes(validate_flow(definition), "warnings")

    def test_unknown_merge_variable_warns_when_lists_are_known(
        self, flow_definition
    ):
        definition = copy.deepcopy(flow_definition)
        definition["nodes"]["greeting"]["prompt"] = {
            "kind": "tts", "text": "Hello {{nonexistent_field}}."
        }
        result = validate_flow(definition, known_variables={"balance"})
        assert result.ok
        assert "unknown_variable" in codes(result, "warnings")

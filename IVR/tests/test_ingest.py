"""Row normalisation and validation (spec 5.2)."""

import pytest

from apps.contacts.ingest import RowError, iter_rows, normalise_phone, parse_row


class TestNormalisation:
    def test_formats_to_e164(self):
        e164, cc, tz = normalise_phone("(212) 555-0123", "US")
        assert e164 == "+12125550123"
        assert cc == "1"
        assert tz.startswith("America/")

    def test_accepts_already_normalised_input(self):
        assert normalise_phone("+254712345678", "US")[0] == "+254712345678"

    def test_rejects_unparseable_input(self):
        with pytest.raises(RowError):
            normalise_phone("not a phone", "US")

    def test_rejects_invalid_number_for_region(self):
        with pytest.raises(RowError):
            normalise_phone("+1555", "US")

    def test_resolves_timezone_from_the_number(self):
        _e164, _cc, tz = normalise_phone("+254712345678", "US")
        assert tz  # Kenyan numbers resolve to Africa/Nairobi


class TestRowParsing:
    def test_extracts_reserved_and_merge_fields(self):
        row = parse_row(
            {"phone": "+12125550123", "first_name": "Ada", "last_name": "Lovelace",
             "balance": "1,240", "plan": "gold"},
            "US",
        )
        assert row["phone_e164"] == "+12125550123"
        assert row["first_name"] == "Ada"
        assert row["variables"] == {"balance": "1,240", "plan": "gold"}
        assert len(row["phone_hash"]) == 64

    def test_missing_phone_is_a_row_error(self):
        with pytest.raises(RowError, match="missing phone"):
            parse_row({"first_name": "Ada"}, "US")

    def test_oversized_variable_is_rejected(self):
        """A 4 KB 'variable' is either a mistake or an attack on the TTS bill."""
        with pytest.raises(RowError, match="exceeds"):
            parse_row({"phone": "+12125550123", "note": "x" * 300}, "US")

    def test_too_many_variables_is_rejected(self):
        row = {"phone": "+12125550123"}
        row.update({f"f{i}": "v" for i in range(50)})
        with pytest.raises(RowError, match="merge variables"):
            parse_row(row, "US")

    def test_explicit_timezone_column_wins(self):
        row = parse_row(
            {"phone": "+12125550123", "timezone": "Europe/London"}, "US"
        )
        assert row["timezone"] == "Europe/London"

    def test_names_are_truncated_not_rejected(self):
        row = parse_row({"phone": "+12125550123", "first_name": "A" * 200}, "US")
        assert len(row["first_name"]) == 80

    def test_hash_is_stable_and_pepper_dependent(self, settings):
        first = parse_row({"phone": "+12125550123"}, "US")["phone_hash"]
        second = parse_row({"phone": "+12125550123"}, "US")["phone_hash"]
        assert first == second

        settings.PHONE_HASH_PEPPER = "a-different-pepper"
        assert parse_row({"phone": "+12125550123"}, "US")["phone_hash"] != first


class TestHeaderHandling:
    def test_case_insensitive_headers(self):
        lines = ["Phone,First_Name\n", "+12125550123,Ada\n"]
        rows = list(iter_rows(lines))
        assert rows[0][1]["phone"] == "+12125550123"
        assert rows[0][1]["first_name"] == "Ada"

    def test_missing_phone_column_raises(self):
        with pytest.raises(RowError, match="missing required column"):
            list(iter_rows(["name,email\n", "Ada,ada@example.test\n"]))

    def test_line_numbers_start_at_two(self):
        lines = ["phone\n", "+12125550123\n", "+12125550124\n"]
        numbers = [lineno for lineno, _row in iter_rows(lines)]
        assert numbers == [2, 3]

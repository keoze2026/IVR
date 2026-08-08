"""
Parsing external suppression lists.

Two failure directions, and they are not symmetric. Missing a number means
dialling somebody who opted out — a compliance breach with a per-call price.
Inventing one means suppressing a contact who never asked to be, which
produces no error anywhere and is only ever noticed as unexplained list
shrinkage. Both are tested; the second is why `normalise` returns None instead
of guessing.
"""

import io
import zipfile

import pytest

from apps.compliance.scrub_sources import (
    ScrubSourceError,
    from_directory,
    normalise,
    parse_bytes,
)


class TestNormalise:
    @pytest.mark.parametrize("raw,expected", [
        ("2125551234", "+12125551234"),        # bare NANP, the SAN format
        ("12125551234", "+12125551234"),       # with country code
        ("+12125551234", "+12125551234"),      # already E.164
        ("(212) 555-1234", "+12125551234"),    # punctuated
        ("212.555.1234", "+12125551234"),
        ("212-555-1234", "+12125551234"),
        (" 2125551234 ", "+12125551234"),      # padded
        ('"2125551234"', "+12125551234"),      # quoted by a CSV writer
        ("+254700392123", "+254700392123"),    # non-NANP E.164
    ])
    def test_recognised_forms(self, raw, expected):
        assert normalise(raw) == expected

    @pytest.mark.parametrize("raw", [
        "", "   ", "not a number", "phone", "12345",
        "0125551234",   # NANP area codes never start with 0
        "1125551234",   # ...nor 1
        "123456789012345678",
        "2026-08-04",   # a date, which digit-stripping would otherwise mangle
    ])
    def test_rejected_rather_than_guessed(self, raw):
        """Anything ambiguous must return None — a wrong number suppresses
        somebody who never opted out, and nothing downstream catches it."""
        assert normalise(raw) is None


class TestParsing:
    def test_plain_text_one_per_line(self):
        data = b"2125551234\n3055551234\n\n4155551234\n"
        assert parse_bytes(data, name="san.txt") == [
            "+12125551234", "+13055551234", "+14155551234"]

    def test_csv_with_a_recognised_header(self):
        data = b"first_name,phone,state\nAda,2125551234,NY\nGrace,3055551234,FL\n"
        assert parse_bytes(data, name="list.csv") == [
            "+12125551234", "+13055551234"]

    def test_csv_with_no_header_at_all(self):
        """The federal SAN download has no header line."""
        data = b"2125551234\n3055551234\n"
        assert parse_bytes(data, name="san.csv") == [
            "+12125551234", "+13055551234"]

    def test_csv_header_is_not_treated_as_data(self):
        data = b"number\n2125551234\n"
        assert parse_bytes(data, name="x.csv") == ["+12125551234"]

    def test_unlabelled_columns_are_scanned(self):
        data = b"Ada,2125551234,NY\nGrace,3055551234,FL\n"
        assert parse_bytes(data, name="x.csv") == [
            "+12125551234", "+13055551234"]

    def test_rows_without_a_number_are_skipped_not_fatal(self):
        data = b"phone\n2125551234\nnot-a-number\n\n3055551234\n"
        assert parse_bytes(data, name="x.csv") == [
            "+12125551234", "+13055551234"]

    def test_zip_of_csvs(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("a.csv", "phone\n2125551234\n")
            zf.writestr("b.csv", "phone\n3055551234\n")
        assert sorted(parse_bytes(buf.getvalue(), name="v.zip")) == [
            "+12125551234", "+13055551234"]

    def test_a_utf8_bom_does_not_break_the_first_row(self):
        data = "﻿phone\n2125551234\n".encode()
        assert parse_bytes(data, name="x.csv") == ["+12125551234"]


class TestDirectorySource:
    def test_reads_only_this_tenants_files(self, tmp_path):
        (tmp_path / "acme-dnc.csv").write_text("phone\n2125551234\n")
        (tmp_path / "othercorp-dnc.csv").write_text("phone\n3055551234\n")
        got = from_directory(str(tmp_path), patterns=["acme*"])
        assert got == ["+12125551234"], "another tenant's list leaked in"

    def test_duplicates_across_files_are_collapsed(self, tmp_path):
        (tmp_path / "acme-1.csv").write_text("phone\n2125551234\n")
        (tmp_path / "acme-2.csv").write_text("phone\n2125551234\n3055551234\n")
        assert from_directory(str(tmp_path), patterns=["acme*"]) == [
            "+12125551234", "+13055551234"]

    def test_no_matching_files_raises_rather_than_scrubbing_nothing(self, tmp_path):
        """A vendor download that silently did not run must not look like a
        successful scrub of an empty list."""
        with pytest.raises(ScrubSourceError, match="no files"):
            from_directory(str(tmp_path), patterns=["acme*"])

    def test_a_missing_directory_raises(self, tmp_path):
        with pytest.raises(ScrubSourceError, match="not a directory"):
            from_directory(str(tmp_path / "nope"), patterns=["*"])


class TestUrlSource:
    def test_plaintext_http_is_refused(self):
        """A suppression list altered in transit means dialling opt-outs."""
        from apps.compliance.scrub_sources import from_url
        with pytest.raises(ScrubSourceError, match="https"):
            from_url("http://vendor.example/dnc.csv")

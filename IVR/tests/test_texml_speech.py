"""The voice and accent sent to each carrier for spoken text."""

from apps.ivr import renderers
from apps.ivr.runtime import Plan, Verb


def say(attrs: dict, provider: str) -> str:
    return renderers.render(Plan(verbs=[Verb("Say", attrs, "Hello")]), provider)


def test_telnyx_english_names_an_american_voice():
    texml = say({"language": "en"}, "telnyx")

    assert '<Say voice="woman" language="en-US">Hello</Say>' in texml


def test_telnyx_speech_nested_in_a_menu_gets_the_same_voice():
    menu = Verb("Gather", {"numDigits": 1}, children=[
        Verb("Say", {"language": "en"}, "Press one"),
    ])

    texml = renderers.render(Plan(verbs=[menu]), "telnyx")

    assert 'voice="woman" language="en-US">Press one</Say>' in texml


def test_telnyx_keeps_a_chosen_voice_and_other_languages():
    assert 'voice="man"' in say({"language": "en", "voice": "man"}, "telnyx")
    assert '<Say language="sw">Hello</Say>' in say({"language": "sw"}, "telnyx")


def test_twilio_speech_is_unchanged():
    assert '<Say language="en">Hello</Say>' in say({"language": "en"}, "twilio")

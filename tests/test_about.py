"""Help modal "Über Adam": contact/donation details come only from environment variables."""

import json
import re

import pytest

from app.about import about_config

ENV = ("ADAM_CONTACT_EMAIL", "ADAM_WEBSITE_URL", "ADAM_DONATE_URL", "ADAM_DONATE_LABEL")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ENV:
        monkeypatch.delenv(name, raising=False)


def page_config(client) -> dict:
    html = client.get("/").get_data(as_text=True)
    m = re.search(r'<script type="application/json" id="about-config">(.*?)</script>', html, re.S)
    assert m, "about config block missing"
    return json.loads(m.group(1))


def test_missing_env_gives_no_values(client):
    assert about_config() == {"contact_email": None, "website_url": None, "donate_url": None, "donate_label": None}
    assert page_config(client) == about_config()


def test_values_from_env(client, monkeypatch):
    monkeypatch.setenv("ADAM_CONTACT_EMAIL", "hallo@example.org")
    monkeypatch.setenv("ADAM_DONATE_URL", "https://example.org/spenden")
    monkeypatch.setenv("ADAM_WEBSITE_URL", "https://example.org")
    cfg = page_config(client)
    assert cfg == {"contact_email": "hallo@example.org", "website_url": "https://example.org",
                   "donate_url": "https://example.org/spenden", "donate_label": "Spenden"}
    monkeypatch.setenv("ADAM_DONATE_LABEL", "  Kaffee   spendieren ")
    assert about_config()["donate_label"] == "Kaffee spendieren"


@pytest.mark.parametrize("name,value", [
    ("ADAM_CONTACT_EMAIL", "kein-mail"),
    ("ADAM_CONTACT_EMAIL", "a@b.c<script>"),
    ("ADAM_DONATE_URL", "javascript:alert(1)"),
    ("ADAM_WEBSITE_URL", "ftp://example.org"),
])
def test_invalid_values_are_hidden(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    key = {"ADAM_CONTACT_EMAIL": "contact_email", "ADAM_DONATE_URL": "donate_url",
           "ADAM_WEBSITE_URL": "website_url"}[name]
    assert about_config()[key] is None


def test_label_without_donate_url_is_ignored(monkeypatch):
    monkeypatch.setenv("ADAM_DONATE_LABEL", "Spenden")
    assert about_config()["donate_label"] is None


def test_injected_json_cannot_break_out_of_the_script_tag(client, monkeypatch):
    monkeypatch.setenv("ADAM_DONATE_URL", "https://example.org/spenden")
    monkeypatch.setenv("ADAM_DONATE_LABEL", "</script><img src=x>")
    html = client.get("/").get_data(as_text=True)
    block = html[html.index('id="about-config">'):]
    assert "<img" not in block[:block.index("</script>")]
    assert page_config(client)["donate_label"] == "</script><img src=x>"

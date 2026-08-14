"""
Pre-domain / internal staging settings.

Prod-shaped — DEBUG off, signatures verified, secrets still required — but with
the HTTPS enforcement relaxed so the portal is reachable by the server's bare IP
over plain HTTP while there is not yet a domain and a TLS certificate in front.

This is a stepping stone, not a destination. The moment a real domain and
certificate are live, switch DJANGO_SETTINGS_MODULE to config.settings.prod:
that turns SECURE_SSL_REDIRECT and the secure-cookie flags back on and refuses
to boot on a non-HTTPS PUBLIC_BASE_URL. Do not leave this facing the public
internet long-term.
"""

import os

from config.settings.base import *  # noqa: F401,F403
from config.settings.base import env, env_bool

DEBUG = False
TENANCY_STRICT = env_bool("TENANCY_STRICT", False)
WEBHOOK_VERIFY_SIGNATURES = True

# --- Headers, minus the parts that require TLS ----------------------------
# No certificate is terminated in front yet, so forcing HTTPS or marking the
# session cookie Secure would make the login cookie never set and lock the
# operator out. Everything that does not depend on TLS stays on.
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = True
X_FRAME_OPTIONS = "DENY"

# --- Fail fast on missing secrets -----------------------------------------
# Same non-negotiables as production, except PUBLIC_BASE_URL, which here is an
# http://<ip>:<port> address rather than an https domain.
_REQUIRED = ["DJANGO_SECRET_KEY", "PHONE_HASH_PEPPER", "POSTGRES_PASSWORD"]
_missing = [k for k in _REQUIRED if not os.environ.get(k)]
if _missing:
    raise RuntimeError(f"Missing required settings: {', '.join(_missing)}")

if os.environ["PHONE_HASH_PEPPER"] == "dev-pepper-change-me":
    raise RuntimeError("PHONE_HASH_PEPPER is still the development default")

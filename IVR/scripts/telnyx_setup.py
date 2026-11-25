"""Run on the server: saves the four TELNYX_* values into IVR/.env. Prints no secrets."""
import getpass, json, os, re, shutil, sys, urllib.request

ENV = os.environ.get("ENV_FILE", "/opt/IVR/IVR/.env")
if len(sys.argv) > 1:  # key supplied in a file, which is removed after reading
    key = open(sys.argv[1]).read().strip()
    os.remove(sys.argv[1])
else:
    while True:
        key = getpass.getpass("Paste your NEW Telnyx API key (Ctrl+Shift+V, stays hidden), then press Enter: ").strip()
        if re.fullmatch(r"KEY[A-Za-z0-9_-]{20,}", key):
            break
        print(f"That is not a full API key: got {len(key)} characters, "
              f"{'starting' if key.startswith('KEY') else 'NOT starting'} with KEY. Try again.")

def get(path):
    req = urllib.request.Request("https://api.telnyx.com/v2/" + path, headers={
        "Authorization": "Bearer " + key, "Accept": "application/json",
        "User-Agent": "ivr-setup/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = json.load(r)
    return body.get("data", body)

try:
    me = get("whoami")
except Exception as e:
    raise SystemExit(f"Could not log in to Telnyx with that key: {e}\nNothing was changed.")

values = {"TELNYX_API_KEY": key, "TELNYX_ACCOUNT_SID": me.get("user_id", "")}
try:
    apps = get("texml_applications")
    values["TELNYX_CONNECTION_ID"] = next(
        str(a["id"]) for a in apps if a.get("friendly_name") == "ivr-texml")
except Exception:
    values["TELNYX_CONNECTION_ID"] = ""
try:
    pk = get("public_key")
    values["TELNYX_PUBLIC_KEY"] = pk.get("public") or pk.get("public_key") or ""
except Exception:
    values["TELNYX_PUBLIC_KEY"] = ""

prompts = {
    "TELNYX_ACCOUNT_SID": "Account ID",
    "TELNYX_CONNECTION_ID": "ivr-texml Application ID",
    "TELNYX_PUBLIC_KEY": "Public Key (left menu > Public Key)",
}
for name, label in prompts.items():
    if not values[name]:
        values[name] = input(f"Could not fetch it automatically. Paste the {label}: ").strip()

shutil.copy(ENV, "/root/ivr.env.backup" if ENV.startswith("/opt/") else ENV + ".backup")
if ENV.startswith("/opt/"):
    os.chmod("/root/ivr.env.backup", 0o600)
text = open(ENV).read()
for name, value in values.items():
    if not value:
        continue
    line = f"{name}={value}"
    text, n = re.subn(rf"(?m)^{name}=.*$", lambda m: line, text)
    if not n:
        text = text.rstrip("\n") + "\n" + line + "\n"
open(ENV, "w").write(text)
for name in values:
    print(f"{name}: {'saved' if values[name] else 'MISSING'}")

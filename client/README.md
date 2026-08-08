# Operator portal

React + TypeScript SPA, plus a small Node service that holds the API
credential so the browser never sees it.

---

## Look at the UI (no backend needed)

```bash
cd client
npm install
npm run demo
```

Open **http://localhost:5173** and paste this key:

```
ivrk_localpreviewkey000000000000000000000
```

That starts three things at once: a fixture API on `:8000`, the credential
service on `:8787`, and the app on `:5173`. No database, no configuration, no
`.env` required — one is generated for the session if you have not made one.

The fixture serves realistic data for every screen, including a throttled
campaign, a draft that has never run, and a caller ID signing below A. Writes
are accepted but not stored, so creating something will not make it appear in
the list afterwards.

> Use **PowerShell, CMD or a normal terminal** for `npm run demo`. Under Git
> Bash the runner cannot spawn its child processes and fails immediately with
> `spawn cmd.exe ENOENT`. If you are stuck in Git Bash, run the three parts in
> separate tabs: `npm run mock`, `npm run dev:bff`, `npm run dev:web`.

---

## Run against the real backend

```bash
cd client
cp .env.example .env      # set IVR_API_BASE and SESSION_SECRET
npm run dev               # credential service + app, no fixture
```

`npm run dev` is the same as `demo` minus the fixture, so it expects a real
API at whatever `IVR_API_BASE` points to — `http://localhost:8000` by default.

Start the backend separately, then get yourself a key:

```bash
cd IVR
python manage.py migrate
python manage.py bootstrap_org --name "Dev" --slug dev --email dev@local
python manage.py runserver
```

`bootstrap_org` prints an access key **once**. Paste it into the login screen.

---

## Configuration

Only three settings, all in `client/.env`:

| Variable | Default | What it does |
|---|---|---|
| `IVR_API_BASE` | `http://localhost:8000` | Where the API lives |
| `SESSION_SECRET` | generated in dev | Signs the session cookie. **Required in production** — 32 characters or more |
| `PORT` | `8787` | Port for the credential service |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Commands

| Command | What it does |
|---|---|
| `npm run demo` | Everything, with fixture data — the one to use for a look |
| `npm run dev` | App + credential service against a real API |
| `npm run mock` | Fixture API alone, on `:8000` |
| `npm run build` | Type-check and produce `dist/` |
| `npm start` | Serve the built app from the credential service, one origin |
| `npm test` | Unit tests |
| `npm run typecheck` | Types only |
| `npm run check:responsive` | Drives Chrome across every route at 320/390/768/1280 and fails on sideways scrolling or an undersized tap target. Needs the dev stack running. |

---

## Ports

| Port | What |
|---|---|
| 5173 | The app you open |
| 8787 | Credential service — the browser calls it under `/bff/*` |
| 8000 | The API, real or fixture |

If a port is busy, something is already running on it. On Windows:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## Production

```bash
npm run build
SESSION_SECRET=<32+ chars> IVR_API_BASE=http://api-host:8000 npm start
```

The credential service serves the built app itself, so everything is one
origin and no cross-origin configuration is needed. `client/Dockerfile` builds
this image.

Further reading: [`../docs/FRONTEND-ARCHITECTURE.md`](../docs/FRONTEND-ARCHITECTURE.md)
for how it fits together, [`../docs/USER-FLOW.md`](../docs/USER-FLOW.md) for
what the screens do.

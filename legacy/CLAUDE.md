# EasyKharcha — working notes

Multi-tenant food-cost control for small restaurants (and homestays, cloud kitchens, bakeries). Staff
record daily opening/closing stock, purchases and wastage; managers record or import sales; the server
reconciles what was bought against what the recipes say should have been used, and surfaces unexplained
loss, cost over target, and late data to the owner.

The product spec is `docs/product.md`. **It is not up for reinterpretation** — only the stack is new.
Open questions and resolved decisions live in `docs/DECISIONS.md`; items marked ⚠ there are the owner's
to answer, not ours to pick.

## Stack

| Layer | Choice |
|---|---|
| Backend | Django 5.1 + DRF + `djangorestframework-simplejwt`, phone + PIN login |
| Database | `DATABASE_URL`-driven. **SQLite locally**, Postgres 16 in production (DECISIONS D-002) |
| Jobs | Celery + Redis (`reports/tasks.py` SLA sweep, hourly beat) |
| Frontend | Expo / React Native, **react-native-web first**, `expo-router`, `@tanstack/react-query` |
| Deploy | Docker Compose + nginx + Let's Encrypt on DigitalOcean — **written, never run** |

## Commands

```bash
# backend (from backend/, with ../.venv activated)
python manage.py runserver 127.0.0.1:8000
python manage.py migrate
python -m pytest                      # 139 tests
ruff check . && black --check .

python manage.py create_superadmin    # reads SUPERADMIN_PHONE / _NAME / _PIN
python manage.py seed_templates --create-canonicals
python manage.py seed_fomo            # real vendors+ingredients, PLACEHOLDER dishes
python manage.py seed_demo --reset    # DEMO tenant with the spec's worked example

# frontend (from mobile/)
npx expo start --web --port 8081
npx tsc --noEmit
npm run smoke            # drives a real browser; needs both servers up
npm run smoke:headful    # same, visible
```

**`npm run smoke` is the only check that executes the app.** `tsc --noEmit` and a successful Metro
bundle both pass on code that throws on first render — a mis-resolved ESM/CommonJS dependency compiles
perfectly and then dies with `x is not a function`. Run it before claiming the client works. It uses
`puppeteer-core` against an installed Chrome/Edge, so there is no Chromium download.

Local Celery (Redis is already running natively on 6379):
```bash
celery -A config worker -l info --pool=solo   # --pool=solo: prefork does not work on Windows
celery -A config beat -l info
```

## How checks are run here

- **Permissions.** `.claude/settings.json` governs what Claude Code may do without asking: file edits
  auto-accept, the routine commands above (`pytest`, `ruff`, `black`, `manage.py`, `npm run smoke`,
  `npx tsc --noEmit`, `npx expo start`, `docker compose config/build/up/down`) are allow-listed.
  `git push`, `sudo`, `rm -rf`, `curl`/`wget`/`Invoke-WebRequest`/`Invoke-RestMethod` (even against
  localhost — use `backend/scripts/smoke.ps1` for live API checks instead), reading a `.env` file, and
  reading anything under `backend/imports/_private/` are denied. If a command you need isn't covered,
  say which one and why instead of working around the block.
- **No throwaway inline scripts.** Never `node -e`, a PowerShell here-string, or a Python heredoc for a
  check, a browser test, or a data script — each one needs its own permission prompt, and nothing is left
  for the next session to re-run. Put it in a file under `scripts/`, `mobile/scripts/`, or
  `backend/scripts/` and expose it as a named command: `npm run smoke`, `pytest`, a `manage.py`
  subcommand. `mobile/scripts/smoke-ui.mjs` (→ `npm run smoke`) and `backend/scripts/smoke.ps1` are the
  existing examples — **extend those** rather than reaching for an inline script to debug something new.
  Browser checks run headless via Puppeteer from a committed script and only ever talk to `localhost`.
- Prefer the Read/Edit/Write tools over shell commands for file work.

## Non-negotiables

These five are the ones worth failing a review over. Each has tests; if you change the behaviour, the
tests should be what tells you.

1. **Tenant isolation.** Every operational row has `business` FK. Filtering happens in
   `core/viewsets.py::TenantScopedViewSet.get_queryset`, and FK inputs are constrained by
   `inventory/serializers.py::TenantScopedRelatedField` — never per-view. A caller with no access to a
   tenant gets **404, not 403**, so tenant ids cannot be probed. `tests/test_tenant_isolation.py`
   parametrises every endpoint; a new endpoint must be added to those lists.

2. **Create vs edit/delete.** Anyone with the role may *create*; **only Owner/Super Admin may edit or
   delete**, and every edit/delete writes an `AuditLog` row with before/after values. Enforced once in
   `core/permissions.py::CapabilityPermission`, which picks the capability by HTTP method. PINs are
   scrubbed in `audit/services.py::scrub` — the only writer to that table.

3. **Live role lookup.** `core/tenancy.py::resolve_access` reads the Access table on every request. The
   JWT carries identity only. Revoking a grant takes effect on the next call, not at token expiry.

4. **Blind counts.** Stock and wastage endpoints never return sales, expected usage, variance, or a
   computed closing figure. The Staff/Head Chef home payload is assembled from a *different set of
   queries* (`reports/home.py::_capture_dashboard`) rather than filtered — there is no sensitive key to
   forget to remove. A chef who can see the expected number will write it down.

5. **Server owns the formulas.** All cost/variance/trend math is in `reports/services.py`. The client
   renders what it is given and never recomputes.

## Where the logic lives

- `reports/services.py` — §5 cost report, §5b variance + coverage rule, §4 alerts, §6 trends. Most
  heavily tested file in the repo. Two documented judgement calls are commented at the top of it.
- `inventory/services.py` — once-per-day capture, impossible-count guard, request auto-fulfilment.
- `recipes/services.py` — template adopt (copies, never links).
- `imports/parsers/` — the format registry. `base.py` defines `SalesParser` + `ParseResult`;
  `registry.py` reads files, fingerprints and dispatches; `generic.py` is the CSV/XLSX fallback.
  **Adding a POS is one parser class + one fixture + one test** — nothing downstream knows any vendor.
- `imports/matching.py` — POS item name → dish. Exact alias, then exact name, then *suggestions*.
- `imports/services.py` — preview assembly, reconciliation, idempotent confirm.
- `core/roles.py` — the capability matrix, written out explicitly because the spec's table is **not**
  rank-monotonic (a Head Chef may raise an inventory request; a Manager may not).

## Things that look like bugs but are not

- `consumed` / `actual_used` are **None, not 0**, when a count is missing. A food-cost report that says
  0% because nobody counted is worse than no report. `totals.complete` and
  `totals.ingredients_missing_counts` say so explicitly — see `tests/test_report_honesty.py`.
- A variance alert is **suppressed** unless recipe coverage is 100%. Half-configured ingredients report
  `incomplete_recipes`. Alerting on partial coverage trains the owner to ignore alerts.
- A POS import never fuzzy-matches automatically. It matches on `pos_alias`/`DishAlias` then exact
  name, and only *suggests* a fuzzy match for a human to confirm. A wrong auto-match moves one dish's
  plates onto another and makes the variance report accuse an honest kitchen.
- An import never overwrites a manually entered Sale. It reports the clash in `blocked_by_manual`.
- Confirming the same file twice is a **no-op**, not a second import (`SalesImport.file_hash`). A
  manager on bad restaurant wifi will press the button again.
- A parser that cannot recognise a file **fails loudly, naming the missing headers**. Guessing column
  positions is how an importer silently corrupts a month of sales.
- The business-day cutoff applies only to values that carry a clock time. A date-only column is already
  a business date; shifting it would move every row in the file back one day.
- **Never commit a real POS export.** Petpooja's carries customer name, phone and address (222 of 510
  rows in FOMO's September file). `import_data/`, `backend/imports/_private/` and `*.xlsx` are
  gitignored; fixtures are synthetic.
- `seed_fomo` dishes are named `PLACEHOLDER — …` at ₹0 on purpose (DECISIONS D-003). Do not "fix" them
  by inventing prices.
- `recipes/data/templates.csv` holds only owner-stated grams. Do not pad the library with plausible
  numbers — wrong defaults produce false variance alerts (DECISIONS O-3).
- `yield_pct` divides **inside** the per-line sum, not outside it: yield is an ingredient property, so
  dishes mixing ingredients of different yields would otherwise be costed wrong.
- The **Stock screen is a ledger**, not just opening/closing: `GET /stock` also returns `wastage_today`
  (today's running total for that ingredient) and `can_add_ingredient` (whether the caller has
  `Capability.CONFIG_ADD`, so Owner/Manager/SA get a quick-add form right there instead of a dead end
  pointing at Admin). Showing an ingredient's *own* logged wastage back is not a blind-count violation
  — it's what the same person just typed, not a sales-derived figure — but wastage has no
  once-per-day lock the way opening/closing does: several spills can happen in one shift.

## Conventions

- Money and quantities are `Decimal` end to end. Quantities 3 dp, money 2 dp.
- One error shape from every endpoint: `{"error": {"code", "message", "detail"}}` (`core/exceptions.py`).
  `message` is shown to the user verbatim, so write it for a cook, not for a developer.
- Management commands live in their owning app (`accounts/`, `tenants/`, `recipes/`), not a top-level
  `management/` package.
- Frontend uses cross-platform primitives only (`View`, `Text`, `TextInput`, `Pressable`, `FlatList`,
  `ScrollView`) so the same components compile to native later. Platform-specific code goes behind
  `*.web.tsx` / `*.native.tsx`.
- **Clear the react-query cache on sign-in and sign-out, and keep the user id in every query key**
  (`src/api/hooks.ts::tenantKey`). Two roles at one tenant get different payloads from the same URL, so
  a tenant-only key served a Head Chef the Owner's revenue dashboard. Non-negotiable #4 is a client
  concern as well as a server one.
- **Five tabs maximum**, per role, in `app/(app)/_layout.tsx`. An Owner can reach eight screens; eight
  tabs on a phone truncates every label. The rest live under More.
- `expo-router@4` requires `query-string` but does not declare it, and React Navigation 7.5 stopped
  providing it. It is pinned to **v7** in `package.json` — v9 is pure ESM and `require()` cannot reach
  its `stringify`.
- **Auth/tenant guards live per-screen, in `src/components/RequireAuth.tsx`** — never in the root
  `app/_layout.tsx`. A layout's job is to render `<Stack>` (and its `<Stack.Screen>` children)
  unconditionally, every render; that is how expo-router learns what routes exist. Swapping it for a
  conditional `<Redirect>` unmounts every registered route in the same pass and crashes the app rather
  than navigating it. `RequireAuth` uses the same leaf-level `<Redirect>` shape `index.tsx` and
  `(app)/_layout.tsx` already used successfully — wrap the screen's content in it, don't touch the
  layout.
- **Never navigate explicitly after `signOut()`.** `(app)/_layout.tsx` and `RequireAuth` already return
  `<Redirect href="/login">` the instant `user` goes null; a screen that *also* calls
  `router.replace('/login')` races that reactive redirect. Two navigations to the same route can force
  a remount of the login screen mid-keystroke — this genuinely happened, discovered via
  `npm run smoke`'s third sign-in/out cycle. `onPress={() => signOut()}` is complete; nothing after it.
- **`scripts/smoke-ui.mjs` fills inputs via `fillInput` (React's native setter + a dispatched `input`
  event), not Puppeteer's `ElementHandle.type()`.** After several sign-in/out cycles, CDP's per-key
  dispatch reproducibly stopped landing on an input that was, by every diagnostic, correctly focused —
  a Puppeteer/CDP timing quirk, not an app bug. `typeForReal` (genuine keystrokes) still runs once, on
  the very first sign-in, so the suite keeps one honest check that typing works at all.

## Not built, deliberately

Direct Petpooja/POS API sync (availability and terms unverified) · invoice-photo OCR (photo is stored
only) · recipes for shared ingredients · sub-recipes/batch prep · stock transfers, returns-to-vendor,
stock-correction entries · offline mode · native store builds · cross-tenant analytics · billing.

WhatsApp delivery sits behind `reports/notifiers.py` with a logging no-op. Group automation is not
feasible at all — Meta's Cloud API caps business-created groups at 8 participants.

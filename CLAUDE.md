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
```

Local Celery (Redis is already running natively on 6379):
```bash
celery -A config worker -l info --pool=solo   # --pool=solo: prefork does not work on Windows
celery -A config beat -l info
```

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
- `imports/parsers.py` + `imports/services.py` — POS report parsing and dish matching.
- `core/roles.py` — the capability matrix, written out explicitly because the spec's table is **not**
  rank-monotonic (a Head Chef may raise an inventory request; a Manager may not).

## Things that look like bugs but are not

- `consumed` / `actual_used` are **None, not 0**, when a count is missing. A food-cost report that says
  0% because nobody counted is worse than no report. `totals.complete` and
  `totals.ingredients_missing_counts` say so explicitly — see `tests/test_report_honesty.py`.
- A variance alert is **suppressed** unless recipe coverage is 100%. Half-configured ingredients report
  `incomplete_recipes`. Alerting on partial coverage trains the owner to ignore alerts.
- A POS import never fuzzy-matches automatically. It matches on `pos_alias` then exact name, and only
  *suggests* a fuzzy match for a human to confirm.
- An import never overwrites a manually entered Sale. It reports the clash in `blocked_by_manual`.
- `seed_fomo` dishes are named `PLACEHOLDER — …` at ₹0 on purpose (DECISIONS D-003). Do not "fix" them
  by inventing prices.
- `recipes/data/templates.csv` holds only owner-stated grams. Do not pad the library with plausible
  numbers — wrong defaults produce false variance alerts (DECISIONS O-3).
- `yield_pct` divides **inside** the per-line sum, not outside it: yield is an ingredient property, so
  dishes mixing ingredients of different yields would otherwise be costed wrong.

## Conventions

- Money and quantities are `Decimal` end to end. Quantities 3 dp, money 2 dp.
- One error shape from every endpoint: `{"error": {"code", "message", "detail"}}` (`core/exceptions.py`).
  `message` is shown to the user verbatim, so write it for a cook, not for a developer.
- Management commands live in their owning app (`accounts/`, `tenants/`, `recipes/`), not a top-level
  `management/` package.
- Frontend uses cross-platform primitives only (`View`, `Text`, `TextInput`, `Pressable`, `FlatList`,
  `ScrollView`) so the same components compile to native later. Platform-specific code goes behind
  `*.web.tsx` / `*.native.tsx`.

## Not built, deliberately

Direct Petpooja/POS API sync (availability and terms unverified) · invoice-photo OCR (photo is stored
only) · recipes for shared ingredients · sub-recipes/batch prep · stock transfers, returns-to-vendor,
stock-correction entries · offline mode · native store builds · cross-tenant analytics · billing.

WhatsApp delivery sits behind `reports/notifiers.py` with a logging no-op. Group automation is not
feasible at all — Meta's Cloud API caps business-created groups at 8 participants.

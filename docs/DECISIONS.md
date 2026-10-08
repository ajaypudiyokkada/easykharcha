# Decisions log

One entry per ⚠ item from `docs/product.md` / `CLAUDE_CODE_PROMPT.md`. Resolved items state the decision
and its consequence in code; open items state what is blocked.

---

## D-001 — Tenant model is `Business`, not `Restaurant`
**Date:** 2026-10-08 · **Status:** Resolved (AP)

The tenant model is `tenants.Business` with a `business_type` field
(`restaurant | homestay | cloud_kitchen | bakery | other`). `business_type` drives **UI labels only** — it
has no behavioural effect anywhere in the backend.

**Consequences**
- All operational models carry `business = FK(tenants.Business)`.
- The REST surface stays tenant-neutral: `/api/tenants/:id/...`. "Tenant" is the API word, `Business` is the
  model word, and the UI word comes from `business_type`.
- `Dish` keeps its model name; the UI labels it "Menu item" for non-restaurant business types.

---

## D-002 — Local deployment: SQLite now, Postgres later
**Date:** 2026-10-08 · **Status:** Resolved (AP), revisit before first real deploy

This machine has no Docker and no WSL2, so the prod-parity Compose stack cannot run here yet. Redis is
installed and running natively on `:6379`, so Celery uses a real broker.

**Consequences**
- Settings are driven by `DATABASE_URL` (`dj-database-url`). Default is `sqlite:///db.sqlite3`; switching to
  Postgres is one env var, no code change.
- `deploy/docker-compose.yml` (postgres 16 + redis + gunicorn + celery worker/beat + nginx) is **written and
  committed** for the DigitalOcean target but is unexercised — it has never been run.
- **Known gap:** SQLite does not reproduce Postgres behaviour on constraint timing, `SELECT … FOR UPDATE`,
  or decimal arithmetic precision. Tenant-isolation and unique-together tests pass under SQLite but must be
  re-run against Postgres before the first real deployment.

---

## D-003 — Seed dishes are explicit placeholders
**Date:** 2026-10-08 · **Status:** Resolved (AP), awaiting real data

The real FOMO dish list and prices were not available. The spec says do not invent prices, so `seed_fomo`
creates dishes named `PLACEHOLDER — <name>` with `price = 0` and code prefix `PH`.

**Consequences**
- Nothing fake can be mistaken for real data: a ₹0 price makes every cost% calculation visibly degenerate
  rather than plausibly wrong.
- Vendors and **ingredients** are seeded with the real rates given in the brief (chicken curry cut ₹320/kg,
  etc.) — those were supplied, so they are not placeholders.
- **To replace:** send the dish list (name, section, price, primary ingredient) and run
  `python manage.py seed_fomo --replace-dishes`.

---

## D-004 — Prototype `FOMO_App.html` not available
**Date:** 2026-10-08 · **Status:** Resolved (AP) — build from spec

The validated prototype was not supplied, so `docs/reference/FOMO_App.html` is absent. Business logic is
implemented strictly from `docs/product.md` §4, §5, §5b, §5c, §5d.

**Consequences**
- The "reproduce the validated figures" fixtures (chicken curry cut ≈ 28.5%, pork ribs ≈ 48.7%) are
  **not** written — there is nothing to verify them against.
- The §5b worked example (boneless chicken, unexplained 0.92 kg ≈ 26.4%) **is** fully covered by tests, since
  the spec states it numerically.
- If the prototype turns up, diff `reports/services.py` against its `LOCAL` object before trusting either.

---

## OPEN — not blocking the local build

| # | Item | Spec ref | Blocked work |
|---|---|---|---|
| O-1 | Flag-only vs. per-tenant hard block when one user records both stock and sales | §1b | Implemented as **flag-only**; a hard-block setting would be a new `Business` field |
| O-2 | "Kitchen efficiency" label and definition to confirm with the owner | §5b | Implemented as `1 − Σ\|unexplained_value\| ÷ Σ(actual_used value)`; label may change |
| O-3 | Who authors/validates the starter recipe-template library | §5d | `seed_templates` reads `backend/recipes/data/templates.csv`, which currently holds only the owner-stated rows |
| O-4 | Which purchased domain (.com/.ai/.in) is primary; EasyKharcha vs Effresto in UI | §10 | nginx `server_name`, TLS, `ALLOWED_HOSTS` — all placeholder in `deploy/` |
| O-5 | DigitalOcean droplet + credentials | prompt | No deployment attempted; nothing touches credentials |
| O-6 | Cross-tenant learning consent terms | §5d | Not built |
| O-7 | WhatsApp BSP choice (Gupshup / Interakt / Twilio) | §8 | Outbound alerts sit behind `reports/notifiers.py` interface with a logging no-op implementation |

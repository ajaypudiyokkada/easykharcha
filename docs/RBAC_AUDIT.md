# Step 24a — RBAC audit (read-only)

Audited against `main` (branch `step-24a-rbac-audit`), no application code changed. Static audit by
reading `backend/businesses/permissions.py`, `access.py`, `team.py`, every app's `views.py`/
`serializers.py`, `config/settings.py`, `config/admin_*.py`. Dynamic probe: `scripts/rbac_probe.py`,
run once against the local dev server (SQLite), results below.

## 1. Role x permission matrix (as built)

Source of truth: `backend/businesses/permissions.py`. `ALL_PERMISSIONS` is a frozenset of 25 strings;
`Owner` is computed as that whole set (`PERMISSIONS = {OWNER: ALL_PERMISSIONS, **_LOWER_ROLE_PERMISSIONS}`,
permissions.py:90-93) — never hand-listed, so a permission added for any role reaches the Owner for
free. A role listing a permission outside `ALL_PERMISSIONS` fails Django's import (`ValueError` at
permissions.py:84-88), so the table can't drift from the registry.

| Permission | Owner | Manager | Head chef | Helper |
|---|---|---|---|---|
| purchases.view / create | X | X | | |
| purchases.edit / delete | X | | | |
| stock.view | X | X | | |
| stockitems.manage | X | | | |
| sellitems.manage | X | | | |
| business.manage | X | | | |
| settings.manage | X | | | |
| team.manage | X | | | |
| team.view | X | X | | |
| counts.create | X | | X | X |
| counts.review | X | X | | |
| counts.status | X | | X | |
| wastage.create | X | | X | X |
| wastage.view_all | X | X | X | |
| wastage.view_own | X | | | X |
| wastage.view_value | X | X | | |
| wastage.delete | X | | | |
| sales.view / create | X | X | | |
| sales.delete | X | | | |
| alerts.view / check | X | X | | |
| reports.view | X | X | | |

Matches `docs/MAP.md`'s table exactly. `access_or_403`/`require_permission` (permissions.py:102-117)
look up `Access` fresh from the DB on every call, never cached — a role change or removal takes
effect on the caller's very next request, with no distinction in the 403 between "not a member" and
"member but missing the permission" (so a non-member can't fingerprint which).

## 2. Static audit — endpoint coverage

Every business-scoped `APIView` in accounts, businesses, stock, counts, wastage, sales, purchases,
alerts, reports, geo calls either `require_permission(business, user, "x.y")`,
`access_or_403`/`permissions_for(access.role)` with an explicit permission-set check, or (team/
onboarding/logo/settings/remind) `owner_access_or_403`. No app ships an `ai/` module yet (MAP.md),
so that item in the brief doesn't apply. No endpoint found gated by a role-name string instead of a
permission string — every check in every view read goes through `permissions.py`'s table.

Queryset/object-lookup scoping: every detail/list view does `get_object_or_404(Business, id=business_id)`
then an Access check keyed to `(user, business)`, then scopes the actual query to `business.<related>`
(e.g. `business.stock_items`, `Purchase.objects.filter(business=business, ...)`). No endpoint reads or
writes a row by id alone without an explicit `business=business` filter or FK traversal from `business`.
Confirmed live: probe's outsider-Owner-B rows (section 3) are 403 on every Business A endpoint,
including by directly guessing Business A's count id.

Money-carrying fields (`usual_price`, `last_unit_price`, `selling_price`, `line_total`, `total_amount`,
`unit_cost_at_entry`/wastage `value`, count `gap_value`/`expected_used`, report `bought`/`wastage_value`/
`cost`/`sales`, alert `numbers.*`/`detail` text) only ever appear behind `stock.view`, `sellitems.manage`,
`sales.view`/`create`, `purchases.view`, `wastage.view_value`, `counts.review`, `reports.view`, or
`alerts.view` — none of which Head chef or Helper hold. Two places strip money explicitly rather than
relying only on the permission gate (defence in depth, not a gap):
- `wastage/views.py:98-100,138-141` — `WastageEntrySerializer` always computes `value`
  (`wastage/serializers.py:41-44`); the view pops the key entirely for a role without `wastage.view_value`,
  on both list and the single-row create response.
- `counts/views.py` (`CountFormView`) never selects price/expected/previous fields at all — the blind
  form is blind by construction (`values("id", "name", "unit")`), not by a client-side hide.

`TodayView` (`counts/views.py:328-388`) is deliberately money-free for every role (per its own
docstring) — confirmed: `wastage_entries_today` and `team_progress.{counted,total}` are counts, not
values; `alerts_count` is a count of alerts, gated to `alerts.view` holders only.

## 3. Dynamic probe results

`scripts/rbac_probe.py` seeded Business A (Owner/Manager/Head chef/Helper) + Business B (its own
Owner, used as a cross-business outsider), with one stock item, one dish with a confirmed recipe, one
purchase, one wastage entry, one sale, and one opening count.

### Endpoint x role status matrix

| Endpoint | Owner | Manager | Head chef | Helper | Outsider (Owner B) | Unauthenticated |
|---|---|---|---|---|---|---|
| GET /me/ | 200 | 200 | 200 | 200 | 200 | 401 |
| GET team/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET settings/ | 200 | 403 | 403 | 403 | 403 | 401 |
| GET stock-items/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET stock-items/\<id\>/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET sell-items/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET suppliers/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET purchases/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET counts/form/?type=opening | 200 | 403 | 200 | 200 | 403 | 401 |
| GET counts/today/ | 200 | 200 | 200 | 200 | 403 | 401 |
| GET counts/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET counts/\<id\>/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET today/ | 200 | 200 | 200 | 200 | 403 | 401 |
| GET wastage/ | 200 | 200 | 200 | 200 | 403 | 401 |
| GET sales/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET alerts/ | 200 | 200 | 403 | 403 | 403 | 401 |
| GET reports/summary/ | 200 | 200 | 403 | 403 | 403 | 401 |

Every cell matches the role x permission matrix exactly (e.g. Manager 403 on `settings/` and
`counts/form/` since Manager has neither `settings.manage` nor `counts.create`; Head chef/Helper 403
on everything money-adjacent, 200 on the blind-count/status/wastage/today endpoints their permissions
actually grant).

### Money-leak matrix

Recursive key scan (price/cost/value/amount/total/rate/... + a literal ₹ in any string) over every
2xx body above, for the three roles that must never see money (Head chef, Helper, cross-business
outsider) plus unauthenticated. One hit:

- `head_chef @ GET today/` → `team_progress.total` — this is `business.stock_items.filter(active=True).count()`
  (`counts/views.py:381`), i.e. "how many stock items exist," not a rupee figure. **False positive**
  from the heuristic's "total" substring match, confirmed by reading the source. No other hits across
  any role/endpoint — Helper, Head chef and the cross-business outsider got zero real money-shaped
  keys anywhere.

### Write-attempt probes

| Probe | Result |
|---|---|
| Manager submits a stock count | 403 (no `counts.create`) |
| Manager records wastage | 403 (no `wastage.create`) |
| Helper edits a stock item's price | 403 (no `stockitems.manage`) |
| Head chef creates a sale | 403 (no `sales.create`) |
| Manager adds a team member | 403 (no `team.manage`) |
| Head chef tries to self-promote to Manager | 403 (no `team.manage`, checked before the object lookup) |
| Outsider Owner B reads Business A's stock items by id | 403 |
| Outsider Owner B reads Business A's count detail by id | 403 |
| Unauthenticated reads Business A's stock items | 401 |

All nine behaved exactly as the plan requires.

## 3b. Team and session rules (read, not probed live beyond the above)

- **Invite/role grants**: only `team.manage` (Owner only) can add/edit/remove team members
  (`businesses/team.py:79-249`). The add-member serializer's role choices are
  `{Manager, Head chef, Helper}` only (`team.py:74-76`) — there is no API path to create or promote
  anyone to Owner. `TeamMemberDetailView.patch` refuses outright if the target's current role is Owner
  (`CannotChangeOwnerRole`, team.py:155-156). `.delete` refuses only removing **yourself** while Owner
  (`CannotRemoveSelf`, team.py:198-199) — there is no second code path to remove a *different* Owner
  because a business can only ever have the one Owner created at `BusinessCreateView` time
  (`businesses/views.py:52-71`); no endpoint can add a second one. Net effect matches the plan (no
  self-promotion, no granting above one's own role, no removing/demoting the last Owner) even though
  the "last Owner" case is prevented structurally (one Owner, full stop) rather than by an explicit
  count check.
- **Immediate effect of a role change/removal**: `Access` is looked up fresh from the DB on every
  request (`permissions.py:102-107`, `access.py:6-11`) — no role or permission claim is baked into the
  JWT (`SIMPLE_JWT` in `config/settings.py:136-143` carries only `user_id`). A removed member's
  *refresh* tokens are blacklisted immediately (`_blacklist_outstanding_tokens`, team.py:45-49,
  called from `.delete` and `TeamResetSecretView`); their current *access* token (up to
  `JWT_ACCESS_MINUTES`, default 60 min) would still authenticate as a user, but every business-scoped
  call re-checks `Access` and gets 403 once the row is gone — only `/me/` and unprotected endpoints
  would still answer, with no business attached.
- **Temporary PIN/secret flow**: there is no separate single-use/expiry invite token. The Owner types
  the new member's real PIN/password directly in the same `POST team/` or `POST team/<id>/reset-secret/`
  call (team.py:120-135, 217-248); it's stored hashed (`set_password`/`create_user`, same hasher as
  everyone else), never returned in any response (`serialize_team_member` only ever returns id/name/
  masked mobile/role/timestamps, team.py:30-42), and never logged (`log_action` calls in team.py never
  pass `secret`). It is **not** single-use or time-limited, and not separately rate-limited beyond the
  app-wide anon throttle (only active when `DEBUG=False`, settings.py:255-258) — see "as planned vs
  built" below.
- **Active business selection**: purely the `business_id` in the URL path, re-validated against
  `Access` on every single request (no header, no claim, no server-side "current business" concept).
  A user cannot reach another business's data by any business id they're not a member of — confirmed
  live by the outsider-Owner-B probe rows above.
- **Login/signup rate limits & enumeration**: `accounts/views.py` rate-limits by IP and by mobile
  separately for signup and login (`RATE_LIMITS` in settings.py:162-179), with a tighter limit/lockout
  for PIN accounts (`PIN_LOGIN_LOCKOUT_THRESHOLD=3` vs `LOGIN_LOCKOUT_THRESHOLD=5`,
  settings.py:152-155). `LoginView` returns the identical `InvalidCredentials` for an unknown mobile,
  a wrong password, and a locked account (`accounts/views.py:104-114`) — no enumeration path found.
- **Django admin**: `UserManager.create_user` defaults `is_staff=False`/`is_superuser=False`
  (`accounts/models.py:16-17`); the only code path that sets `is_staff=True` is
  `create_superuser` (`accounts/models.py:26-35`), reachable only via `manage.py createsuperuser` /
  Django shell, never any API endpoint — so no business user can ever get admin access through the
  app. `business`/`stock`/API-side code never reads `is_staff`/`is_superuser` (confirmed by `User`'s
  own docstring at accounts/models.py:38-41 and by grep across the business apps) — platform-admin
  status grants zero rights inside the business APIs, matching the plan. Not exercised live (would
  need a browser hit on `/manage-ek/` with a non-staff JWT-only session, which has no cookie session
  to begin with — Django admin uses `django.contrib.sessions`, a separate auth path from the API's
  JWT-only `DEFAULT_AUTHENTICATION_CLASSES`, so a business user literally has no session to present).

## 4. Findings

No Critical or High findings. Two Low items worth a decision, both about the team "invite" flow, not
about any actual money/cross-business leak:

| Severity | What | Where | Reproduce | Suggested fix |
|---|---|---|---|---|
| Low | The team "invite" secret is the real, final PIN/password, typed directly by the Owner — not a single-use, expiring temporary credential as the brief's language ("temporary PIN/secret flow for invited staff: single use, expiry") implies. | `backend/businesses/team.py:120-135` (`TeamListCreateView.post`), `:217-248` (`TeamResetSecretView`) | Call `POST .../team/` as Owner; the `secret` field in the request becomes the member's permanent login immediately, no separate claim/activation step. | Decision, not a bug: either accept the current direct-secret model (simpler, already shipped, already smoke-tested) or build an actual single-use/expiring invite token later. |
| Low | `User.must_change_password` is set when a Manager is added or reset (team.py:132, 179, 234) but nothing reads it anywhere — no endpoint or mobile screen forces a password change on first login (confirmed by the field's own docstring, `accounts/models.py:69-72`: "nothing enforces it yet"). | `backend/accounts/models.py:69-74` | Add a Manager via `POST team/`, log in with the temporary password: nothing distinguishes that session from a permanent-password one. | Decision: either wire an enforcement check (401/redirect until changed) or drop the field/docstring claim if it's no longer planned. |

## "As planned vs as built"

- Everything in the brief's "What we planned" section matches the code and the live probe: Owner
  computed from `ALL_PERMISSIONS`; Manager sees money but doesn't count stock or record wastage; Head
  chef/Helper count stock and record wastage and never see money anywhere; counts are blind for every
  role including Owner; unusual-high counts return 409 with item ids only (`counts/exceptions.py:10-20`)
  and counts are create-only (no PATCH/PUT in `counts/urls.py`); the server is the real check
  (`/me/` just lists permissions, `mobile/src/auth/permissions.ts`'s `can()` only gates UI — not
  itself capable of granting a request); platform admin is separate and toothless inside business
  APIs; role labels vary by sector only in copy (`sectorCopy.ts`), never in `permissions.py`'s table;
  a user can belong to >1 business, every request scoped to the URL's business id.
- The one real difference: the brief describes a "temporary PIN/secret flow" with single use/expiry/
  rate limiting as its own concept — the app instead has the Owner set the real secret directly, with
  no separate invite-token lifecycle (see Finding 1 above). Everything else asked of that flow (hashed
  storage, never logged, never re-returned) **is** built as planned.

## Things that look intentional but deserve a decision

1. The direct-secret team-add flow (Finding 1) and the unenforced `must_change_password` flag
   (Finding 2) — both already called out above.
2. `TeamResetSecretView`/`team.py`'s secret-change paths aren't rate-limited by anything narrower than
   the global anon throttle, which is itself only active outside `DEBUG`. Fine for today's single-
   Owner-does-this-by-hand usage; worth a dedicated limit if team size or attacker exposure grows.
3. No `ai/` app exists yet, so section "endpoints... if present" had nothing to audit there — not a
   gap, just not built yet per `docs/MAP.md`.

## Time and branch

Took the full static read + a live dynamic probe within the 45-minute box. Branch `step-24a-rbac-audit`
off an up-to-date `main`; only `scripts/rbac_probe.py` and `docs/RBAC_AUDIT.md` added, no application
code, migrations, or settings touched. Not yet merged — pending your read of the findings above.

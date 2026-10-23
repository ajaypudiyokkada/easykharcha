# Deploying EasyKharcha

One DigitalOcean droplet (1 vCPU, 2 GB RAM, Ubuntu 24.04, Docker + compose installed), running the
whole stack from `docker-compose.prod.yml`: Postgres, the Django backend, the `worker` service (reads
uploaded menus — see backend/ai/), the PWA web export, the landing page, and Caddy in front of all
four on `easykharcha.com` / `app.easykharcha.com` / `api.easykharcha.com`. The server builds its own
images from a `git pull` — nothing is built on Windows and pushed.

### The `worker` service

Same image as `backend`, just a different command (`python manage.py run_ai_jobs`) — both share
`backend/entrypoint.sh`, which `exec`s whatever command it's given (falling back to gunicorn only
when none is passed), so this really does run the job-polling loop rather than a second gunicorn. The
worker sets `RUN_SETUP=0` so it skips migrate/load_pincodes/collectstatic (only `backend` runs those)
and `depends_on` the backend's own healthcheck, so it never starts before the schema it needs exists.
`restart: unless-stopped` brings it back if the loop ever crashes outright; the loop itself logs a
start line, a heartbeat every 5 minutes while idle, and each job's id and outcome (never menu
content) — `docker compose -f docker-compose.prod.yml logs -f worker` is the place to check if scans
are stuck. A job that raises is marked failed (not left `queued`/`reading` forever) and the loop keeps
going; a job stuck in `reading` for more than 10 minutes is recovered the same way on the next poll.

## First time on a new server

1. Clone the repo and `cd` into it.
2. `cp deploy/.env.production.example deploy/.env.production`, then fill in every value marked
   "REQUIRED" inside it — at minimum `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD` (keep the password in
   sync with `DATABASE_URL`'s own copy of it in the same file). Set `ANTHROPIC_API_KEY` too if menu
   reading should work for real — leave `AI_FAKE=false` as shipped; without a key, AI endpoints will
   just fail each call rather than silently going fake.
3. Generate the secret key:
   ```bash
   docker compose -f docker-compose.prod.yml run --rm backend python -c \
     "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
   ```
   Paste the result into `DJANGO_SECRET_KEY` in `deploy/.env.production`.
4. `chmod +x deploy.sh deploy/backup.sh`, then `./deploy.sh`. First run builds every image, starts
   Postgres, runs migrations (the backend's own entrypoint does this on every start), and brings
   everything up behind Caddy, which issues its own certificates automatically on first request to
   each domain — DNS for all four hostnames must already point at this server before this step.
5. **Create the first account.** Open `https://app.easykharcha.com/signup` and sign up for real, the
   same way any business owner would — this is unrelated to platform-staff admin access below.
6. Test the four URLs: `https://easykharcha.com` (landing), `https://app.easykharcha.com` (signup
   should land you in the app), `https://api.easykharcha.com/api/v1/health/` (should report
   `{"status": "ok", ..., "database": "ok"}`), `https://www.easykharcha.com` (should redirect to
   `https://easykharcha.com`).
7. **Create the first admin (platform staff) account.** This is separate from a business account
   above — it's for you, the platform owner, to look up accounts/businesses for support, and has
   nothing to do with business roles (Owner/Manager/Head chef/Helper). Run:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file deploy/.env.production run --rm \
     -e DJANGO_SUPERUSER_MOBILE=9XXXXXXXXX \
     -e DJANGO_SUPERUSER_NAME="Your name" \
     -e DJANGO_SUPERUSER_PASSWORD='a-strong-password' \
     backend python manage.py createsuperuser --noinput
   ```
   Then sign in at `https://api.easykharcha.com/<ADMIN_URL_PATH>` (the path is whatever
   `ADMIN_URL_PATH` is set to in `deploy/.env.production`, default `manage-ek/` — never `/admin/`).
   Don't leave `DJANGO_SUPERUSER_PASSWORD` sitting in `deploy/.env.production`; it's only read at the
   moment `createsuperuser` runs, so pass it inline as above instead.

## Day to day

- **Deploy a change:** `./deploy.sh` — pulls `main`, rebuilds, restarts, waits for the backend's own
  healthcheck, prints `docker compose ps`, prunes old images. Exits non-zero (and prints the backend's
  last 100 log lines) if it never comes up healthy.
- **View logs:** `docker compose -f docker-compose.prod.yml logs -f [service]` (`backend`, `worker`,
  `web-app`, `landing`, `caddy`, `db`).
- **Reset a lost admin password:**
  ```bash
  docker compose -f docker-compose.prod.yml --env-file deploy/.env.production run --rm \
    backend python manage.py changepassword 9XXXXXXXXX
  ```
  (mobile number is the login, same as the app). To make an existing account a platform-staff admin
  instead of creating a new one, use `python manage.py shell` and set `is_staff = True` /
  `is_superuser = True` on that `User`, then `.save()`.
- **Back up the database:** `./deploy/backup.sh` — `pg_dump`s to `/opt/easykharcha/backups`, gzipped,
  timestamped, keeps the last 14. Not installed on a schedule by this repo; add it yourself with:
  ```
  0 2 * * * cd /opt/easykharcha/app && ./deploy/backup.sh >> /var/log/easykharcha-backup.log 2>&1
  ```
- **Roll back to the previous commit:**
  ```bash
  git log --oneline -5          # find the commit to go back to
  git switch main
  git reset --hard <commit>     # main is the deploy branch here; reset it, don't rewrite history on origin
  docker compose -f docker-compose.prod.yml --env-file deploy/.env.production build
  docker compose -f docker-compose.prod.yml --env-file deploy/.env.production up -d
  ```
  A database migration from the rolled-back commit is **not** automatically reversed — check
  `backend/*/migrations/` for what changed before rolling back past a migration that isn't reversible.

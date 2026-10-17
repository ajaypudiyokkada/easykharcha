# Deploying EasyKharcha

One DigitalOcean droplet (1 vCPU, 2 GB RAM, Ubuntu 24.04, Docker + compose installed), running the
whole stack from `docker-compose.prod.yml`: Postgres, the Django backend, the PWA web export, the
landing page, and Caddy in front of all four on `easykharcha.com` / `app.easykharcha.com` /
`api.easykharcha.com`. The server builds its own images from a `git pull` — nothing is built on
Windows and pushed.

## First time on a new server

1. Clone the repo and `cd` into it.
2. `cp deploy/.env.production.example deploy/.env.production`, then fill in every value marked
   "REQUIRED" inside it — at minimum `DJANGO_SECRET_KEY` and `POSTGRES_PASSWORD` (keep the password in
   sync with `DATABASE_URL`'s own copy of it in the same file).
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
5. **Create the first account.** This app has no Django admin and no superuser concept — `User` is a
   plain `AbstractBaseUser` with no `is_staff`/`is_superuser` fields, so `manage.py createsuperuser`
   does not apply here. Open `https://app.easykharcha.com/signup` and sign up for real, the same way
   any business owner would.
6. Test the four URLs: `https://easykharcha.com` (landing), `https://app.easykharcha.com` (signup
   should land you in the app), `https://api.easykharcha.com/api/v1/health/` (should report
   `{"status": "ok", ..., "database": "ok"}`), `https://www.easykharcha.com` (should redirect to
   `https://easykharcha.com`).

## Day to day

- **Deploy a change:** `./deploy.sh` — pulls `main`, rebuilds, restarts, waits for the backend's own
  healthcheck, prints `docker compose ps`, prunes old images. Exits non-zero (and prints the backend's
  last 100 log lines) if it never comes up healthy.
- **View logs:** `docker compose -f docker-compose.prod.yml logs -f [service]` (`backend`, `web-app`,
  `landing`, `caddy`, `db`).
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

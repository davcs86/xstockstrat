# Smoke read-only DB role

`xstockstrat-smoke` reads the database through a dedicated role `xstockstrat_staging_smoke_ro` (staging only; database `xstockstrat-staging`). The DBA creates it;
nothing in this repo creates it or holds its password.

## Create (DBA, per environment)

1. The password must be URL-safe (letters, digits, `-._~`): it is embedded unescaped in `DATABASE_URL`.
2. Connect to the direct endpoint (`:25060`) as an admin (`docs/runbooks/operator-db-access.md`).
3. Run `services/xstockstrat-smoke/db/smoke_readonly_role.sql` with `-v smoke_ro_password=...`.
   It grants `SELECT` on the service schemas, withholds `identity.*` and `config_values.value_encrypted`,
   and sets `default_transaction_read_only=on`.
4. Store the password: DO dev as the GitHub secret `DEV_SMOKE_DB_PASSWORD` (filled into `YOUR_DEV_SMOKE_DB_PASSWORD`
   in `.do/app.dev.yaml`); homelab staging in the staging `APP_ENV` (the DSN user is `xstockstrat_staging_smoke_ro`).

## Verify

- The smoke container logs no "db role not read-only" degradation; `GET /checks` plus a DB check returns `PASS`.
- As the role, `INSERT`/`UPDATE` fails with SQLSTATE `25006`.

An absent role or wrong password degrades DB checks to `ERROR`; the service still boots.

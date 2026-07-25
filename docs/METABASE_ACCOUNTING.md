# Metabase accounting analytics

The ERP signs every embedded dashboard session on the backend and locks the
`tenant_id` dashboard parameter to the authenticated user's tenant. The
embedding secret is never sent to the browser.

## Production setup

1. Set strong values in the production environment:
   - `METABASE_APP_DB_PASSWORD`
   - `METABASE_EMBEDDING_SECRET`
   - `METABASE_SITE_URL`
   - `METABASE_ACCOUNTING_DASHBOARD_ID`
2. Start the isolated Metabase stack:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.analytics.yml up -d metabase-db metabase
   ```

3. Reverse proxy `reports.m1store-egy.com` to `127.0.0.1:3000` with HTTPS.
4. In Metabase, add the ERP PostgreSQL database using a dedicated read-only
   database role. Never use the ERP owner/superuser account.
5. Build the accounting dashboard from reporting views and add a required
   locked dashboard filter named exactly `tenant_id`.
6. Enable signed embedding for that dashboard and copy its numeric ID to
   `METABASE_ACCOUNTING_DASHBOARD_ID`.
7. Restart the ERP backend so it reads the new environment values.

## Required database isolation

Every reporting view/card must expose `tenant_id`, and every embedded card must
be connected to the locked `tenant_id` dashboard filter. Prefer a reporting
schema or replica and grant the Metabase database role `SELECT` only.

The native `/accounting/reports` page remains available if Metabase is offline
or not configured.

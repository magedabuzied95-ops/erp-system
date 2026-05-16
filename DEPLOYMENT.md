# ERP SaaS Deployment

This document covers local Docker, Ubuntu VPS deployment, PM2 fallback, backups, monitoring, and production hardening.

## 1. Local Docker flow

Create `.env` from [\.env.example](./.env.example) and `server/.env` from [server/.env.example](./server/.env.example).

Run:

```bash
docker compose up --build
```

Services:
- Frontend: `http://localhost:8080`
- Backend: `http://localhost:8000`
- PostgreSQL: internal to Docker network

## 2. Ubuntu VPS deployment

Recommended baseline:
- Ubuntu 22.04 or 24.04 LTS
- 2 vCPU minimum
- 4 GB RAM minimum
- SSD storage

### Server setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw nginx certbot python3-certbot-nginx
```

Install Docker:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in after adding your user to the `docker` group.

### Firewall

Recommended firewall policy:
- allow `22` for SSH
- allow `80` for Certbot and HTTP redirect
- allow `443` for HTTPS
- do not expose PostgreSQL on `5432` publicly

Example:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 3. Production startup commands

### Docker production

Copy the env examples and set production values.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.override.example.yml up -d --build
```

### PM2 fallback

Use PM2 if you are not deploying with Docker:

```bash
npm install -g pm2
npm run db:setup
npm run db:seed
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Recommended PM2 behavior:
- `autorestart: true`
- `max_memory_restart` enabled
- `pm2 save` after the process starts cleanly
- use `pm2 logs` for live log inspection

## 4. Domain and DNS

Point your domain A record to the VPS public IP.

Typical layout:
- `erp.example.com` for the frontend
- same domain reverse proxies `/api` and `/socket.io` to the backend

Update:
- `FRONTEND_URL`
- `VITE_API_BASE_URL`
- `VITE_SOCKET_URL`

Use the production domain, not localhost.

## 5. SSL with Certbot

If you terminate TLS on the host Nginx:

```bash
sudo certbot --nginx -d erp.example.com -d www.erp.example.com
```

Certbot will update the Nginx config and renew automatically if the timer is active.

If you terminate TLS elsewhere, keep the Nginx config TLS placeholders in [nginx/production.conf.example](./nginx/production.conf.example).

## 6. Nginx production config

Use [nginx/production.conf.example](./nginx/production.conf.example) as the production reference.

It includes:
- HTTP to HTTPS redirect
- SSL placeholders
- gzip compression
- security headers
- `/api` reverse proxy
- `/socket.io` WebSocket proxy
- static asset caching

## 7. Docker production override

Use [docker-compose.prod.override.example.yml](./docker-compose.prod.override.example.yml) as the production overlay.

It adds:
- restart policies
- PostgreSQL persistent storage
- uploads persistent storage
- health checks

Keep PostgreSQL data on a named volume or external persistent disk.

## 8. Database setup

Schema file:
- [server/database/schema.sql](./server/database/schema.sql)

Bootstrap scripts:
- `npm run db:setup`
- `npm run db:seed`

The seed inserts:
- the platform tenant
- the admin role set
- the admin user
- the default cashbox

## 9. Backup strategy

Scripts:
- [server/scripts/backupDb.sh](./server/scripts/backupDb.sh)
- [server/scripts/restoreDb.sh](./server/scripts/restoreDb.sh)

Example manual backup:

```bash
export DATABASE_URL="postgres://..."
./server/scripts/backupDb.sh
```

Restore:

```bash
export DATABASE_URL="postgres://..."
./server/scripts/restoreDb.sh backups/erp_2026-05-09_12-00-00.sql.gz
```

Cron example:

```bash
0 2 * * * DATABASE_URL="postgres://..." BACKUP_DIR="/var/backups/erp" /opt/erp/server/scripts/backupDb.sh
```

Backup notes:
- keep one local backup
- keep one off-host backup
- test restore regularly
- back up uploads separately if invoice PDFs, product images, or attachments are stored there

## 10. Monitoring

Health endpoint:
- `GET /health`

Use it for:
- uptime monitoring
- container health checks
- load balancer probes

Recommended monitoring stack:
- Uptime Kuma, Better Stack, or a similar external probe
- host-level metrics via node exporter or your VPS provider
- container logs via `docker compose logs -f` or `pm2 logs`

Logs folder structure:
- `logs/backend/`
- `logs/nginx/`
- `logs/backup/`

Create the directories on the server and rotate them with logrotate if you are not using a managed logging system.

## 11. Security notes

- Use a strong random `JWT_SECRET` per environment.
- Do not reuse dev secrets in production.
- Store `.env` files outside the public web root.
- Do not expose PostgreSQL to the public internet.
- Keep `CORS` restricted to your production frontend domain.
- Add rate limiting at the reverse proxy or API layer before opening the system publicly.
- Keep admin credentials disabled from public onboarding flows in production.
- Use long, non-guessable database passwords.

## 12. Troubleshooting

### Backend will not start

- confirm `DATABASE_URL`
- confirm `JWT_SECRET`
- check `pm2 logs` or `docker compose logs backend`
- confirm PostgreSQL is healthy

### Frontend cannot call the API

- check `VITE_API_BASE_URL`
- confirm nginx proxies `/api`
- confirm `FRONTEND_URL` matches the live domain

### Socket events do not work

- confirm nginx proxies `/socket.io`
- confirm the backend CORS origin matches the production domain

### Database schema was not created

- run `npm run db:setup`
- verify the PostgreSQL credentials in `DATABASE_URL`
- check the container startup logs

### Backup restore fails

- confirm the dump file is not truncated
- confirm the target database exists
- verify the role has permission to create tables and sequences

## 13. Suggested production startup order

1. Start PostgreSQL.
2. Apply schema and seed data.
3. Start the backend.
4. Verify `/health`.
5. Start the frontend or nginx static container.
6. Point the domain and issue SSL.


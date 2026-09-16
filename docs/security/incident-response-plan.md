# Incident Response Plan — M One Shoes Store

| Field | Value |
|---|---|
| Organization | M One Shoes Store (https://www.m1store-egy.com) |
| Scope | The M1 ERP system, its production server, its integrations, and all **Amazon Information** (data obtained through the Amazon Selling Partner API) |
| Document owner | Security Incident Lead (see §3) |
| Version | 1.0 |
| Effective date | 2026-09-16 |
| Review cycle | At least every **6 months**, and after every Severity 1–2 incident |
| Next scheduled review | **2027-03-16** |
| Classification | Internal — not published on any public web server |

---

## 1. Purpose

This plan defines how M One Shoes Store detects, reports, contains, eradicates and recovers from security incidents, and how it notifies affected parties. It includes the notification duties that apply to Amazon Information under the Amazon Data Protection Policy (DPP) and the Selling Partner API terms.

## 2. Scope

The plan covers:

- the production VPS (Ubuntu 24.04, Nginx, Docker, PostgreSQL, Redis) and the staging stack on the same host;
- the ERP backend (`erp-backend`) and frontend (hosted on Vercel), the channel gateway, and the WhatsApp gateway;
- all credentials: SSH keys, database passwords, JWT/encryption keys, Amazon LWA client credentials and refresh tokens, AWS IAM credentials (if used for SP-API), and Meta, TikTok, Bosta and payment keys;
- all personnel and contractors with access to the systems above;
- **Amazon Information**: any data received from Amazon through SP-API, including order, buyer, shipping-address and financial data, wherever it is stored, processed or transmitted.

## 3. Roles and responsibilities

The organization is small, so one person may hold more than one role. Each role has a named primary and a backup. Fill in the names below and keep them current at every review.

| Role | Primary | Backup | Responsibilities |
|---|---|---|---|
| **Security Incident Lead (SIL)** | Owner — _name / phone / email_ | _Name / phone_ | Declares incidents, sets severity, coordinates the response, **owns external notifications including the notice to Amazon**, and approves closure |
| **Technical Responder** | _Name / phone_ | _Name / phone_ | Server, Docker, database and application investigation; containment; eradication; recovery |
| **Credentials Custodian** | Owner | _Name / phone_ | Rotates and revokes keys and tokens (Amazon LWA/SP-API, AWS, DB, JWT, SSH), and records every rotation |
| **Communications / Records** | _Name / phone_ | Owner | Keeps the incident log, drafts notifications, and preserves evidence |
| **All staff** | — | — | Report any suspected incident **immediately** (see §5) and never try to investigate alone |

Escalation contacts: hosting provider (Contabo support), Cloudflare, Vercel, and the application developer.

## 4. What counts as a security incident

A security incident is any actual or reasonably suspected event that compromises the confidentiality, integrity or availability of our systems or data. Examples:

- unauthorized access to the server, the ERP, the database, or any account (including a successful login from an unknown location);
- disclosure, loss, theft or unauthorized use of **Amazon Information** or of customer personal data;
- leaked, exposed or misused credentials, API keys, SP-API/LWA tokens, or SSH keys (including secrets committed to a repository or pasted into chat);
- malware detected by ClamAV, or suspicious processes or files;
- Suricata IDS alerts that indicate exploitation or a compromise, repeated Fail2Ban bans that indicate a targeted attack, or unexplained firewall changes;
- unauthorized changes to users, roles, MFA, firewall, SSH or Nginx configuration (auditd keys `identity`, `privilege`, `sshd_config`, `firewall`, `secrets`);
- a lost or stolen device that holds company credentials or an authenticator app;
- denial-of-service or ransomware events;
- a vendor or sub-processor reporting a breach that affects our data.

### Severity levels

| Severity | Definition | Examples |
|---|---|---|
| **S1 — Critical** | Confirmed or likely compromise of Amazon Information or customer personal data, or attacker control of production | Database exfiltration, root compromise, leaked SP-API refresh token in active use |
| **S2 — High** | Credential exposure or unauthorized access without confirmed data access | Leaked API key, unknown admin login, malware on the server |
| **S3 — Medium** | Contained attack attempt or policy violation | Targeted brute force that was blocked, a mis-granted role |
| **S4 — Low** | Suspicious activity with no impact | IDS noise, single phishing email reported |

**Any incident that involves or may involve Amazon Information is treated as at least S2 until proven otherwise.**

## 5. Detection and reporting

**Detection sources**

- **Security audit log** (`security_audit_events` table, `GET /api/security/audit-events`): logins, failed logins, account lockouts, MFA events, password and role changes, and Amazon data access.
- **SSH and system**: `/var/log/auth.log`, `journalctl -u ssh`, and auditd (`ausearch -k <key>`).
- **Fail2Ban**: `/var/log/fail2ban.log` and `fail2ban-client status sshd` / `recidive`.
- **Firewall**: `/var/log/ufw.log`, and the `DOCKER-USER` drop counters.
- **IDS**: Suricata `/var/log/suricata/fast.log` and `eve.json`.
- **Anti-malware**: `/var/log/clamav-scan/`, and syslog tag `m1-clamav` (priority `auth.crit` means malware was found).
- **Application logs**: `docker logs erp-backend` (`[security-audit]` lines, `[auth]` lines).
- Reports from staff, customers, vendors, or Amazon.

**Reporting**

Anyone who suspects an incident must tell the Security Incident Lead **immediately**, by phone or WhatsApp. They must not delete anything, must not "clean up", and must not discuss it outside the response team. The time the incident was first detected is recorded as **T0**, and all notification deadlines run from T0.

## 6. Response procedure

### 6.1 Triage (target: within 1 hour of T0)

1. Open an incident record (template in §10) and record T0, who reported it, and what was observed.
2. Decide the severity (§4) and whether **Amazon Information** is or may be involved.
3. Assign the Technical Responder and start the notification clock (§7).

### 6.2 Evidence preservation (before changing anything, where safe)

- Copy the relevant logs to `/root/incident-<YYYYMMDD>-<id>/` (mode 700): auth.log, ufw.log, fail2ban.log, Suricata eve.json/fast.log, ClamAV scan logs, `ausearch` output, `docker logs erp-backend`, and an export of `security_audit_events` for the period.
- Record `ss -tulpn`, `docker ps`, `ufw status verbose`, `iptables-save`, `last -a`, and the running processes.
- Record SHA-256 hashes of the collected files. Keep a chain-of-custody note: who collected what, and when.
- If a disk or VM snapshot is needed, take it through the Contabo panel before eradication.
- **Never copy secret values into incident notes.**

### 6.3 Containment

Choose the smallest effective action:

- block attacker IPs (`fail2ban-client set sshd banip <ip>` or `ufw deny from <ip>`);
- disable affected ERP accounts (Users page, set inactive), reset their password, and **reset their MFA**. Password and MFA changes revoke every existing session automatically (token version);
- revoke the Amazon SP-API authorization or rotate the LWA client secret (§6.5), and suspend the Amazon integration if Amazon Information is at risk;
- isolate a compromised container (`docker stop <name>`) or restrict a port in `DOCKER-USER`;
- for a server compromise: restrict SSH to known IPs and, if needed, take the service offline and use the Contabo VNC console.

### 6.4 Eradication

- Identify the root cause (vulnerability, leaked credential, misconfiguration).
- Remove malware and unauthorized accounts, keys (`/root/.ssh/authorized_keys`), cron jobs and files.
- Patch the software (`apt upgrade`, rebuild images) and fix the misconfiguration.
- Run a full ClamAV scan (`/usr/local/sbin/m1-clamscan full`) and review Suricata alerts again.

### 6.5 Credential and API-key rotation

Rotate every credential that may be exposed, and record each rotation (what, when, who — **never the value**):

| Credential | Where | How |
|---|---|---|
| Amazon LWA client secret | Amazon Developer Central / Solution Provider Portal | Generate a new secret, update the server `.env`, recreate `erp-backend`, then revoke the old secret |
| SP-API refresh token | Seller Central → Apps & Services → Manage Your Apps | Revoke the authorization and re-authorize |
| AWS IAM access keys (if used) | AWS IAM | Create a new key, deploy it, deactivate and then delete the old key |
| `JWT_SECRET` | `/opt/erp/backend/.env` | Replace the value and recreate the backend. This signs out every user. **Set `MFA_ENCRYPTION_KEY` first**, or MFA enrolments become unreadable |
| Database passwords | Postgres + `.env` | `ALTER ROLE … PASSWORD`, update `.env`, recreate the containers |
| SSH keys | `/root/.ssh/authorized_keys` | Remove the exposed key and add a new one |
| Meta / TikTok / Bosta / payment keys | Each provider's console | Regenerate and update `.env` |

### 6.6 Recovery

- Restore from a clean backup if integrity is in doubt (daily `erp-backup.sh`, plus the monthly restore test).
- Bring services back gradually and watch `/health`, the security audit log, the IDS and Fail2Ban for at least 72 hours.
- Confirm with the SIL before declaring normal operations.

## 7. Notification procedures

### 7.1 Amazon — REQUIRED

> **Any security incident involving Amazon Information will be reported to Amazon at `security@amazon.com` within 24 hours of detection (T0).**

- **Who:** the Security Incident Lead, or their backup if the SIL is unavailable.
- **When:** as soon as Amazon Information is known or suspected to be involved, and **no later than 24 hours after T0**. Do not wait for the investigation to finish; send updates as facts become known.
- **What to include:** organization name and developer ID; the SP-API application involved; the date and time of detection (with time zone); a description of the incident; the categories and approximate volume of Amazon Information affected; the containment actions taken; the credentials rotated or revoked; a contact person with phone and email; and the next update time.
- **Record:** keep a copy of the email and its sent time in the incident record.
- Also follow any additional instructions in the Amazon Services API Developer Agreement and the Data Protection Policy, and cooperate with Amazon's requests for information.

Email template:

```
To: security@amazon.com
Subject: Security Incident Notification – M One Shoes Store – <Developer ID> – <YYYY-MM-DD>

Organization: M One Shoes Store
Developer ID / Application: <id> / <app name>
Detected (T0): <YYYY-MM-DD HH:MM Africa/Cairo>
Summary: <what happened>
Amazon Information involved: <types, approx. records, time range>
Status: <contained / under investigation>
Actions taken: <containment, credentials rotated/revoked>
Contact: <name>, <email>, <phone>
Next update: <time>
```

### 7.2 Other notifications (within 24 hours of T0 where applicable)

- **Internal:** the owner and management, immediately.
- **Affected customers / individuals:** as required by applicable law (for example Egypt's Personal Data Protection Law No. 151 of 2020) and after consulting counsel.
- **Authorities:** as required by law.
- **Vendors:** the hosting provider (Contabo), Cloudflare, Vercel, Meta, Bosta and payment providers, if their services or credentials are involved.

## 8. Post-incident review

Within **7 days** of closing an S1–S3 incident:

- write a root-cause analysis and timeline;
- record what worked, what did not, and the corrective actions, each with an owner and due date;
- update this plan, the firewall/IDS rules, and the access roles as needed;
- keep the review with the incident record.

## 9. Plan maintenance and testing

- Review this plan **at least every 6 months** (next: 2027-03-16), and after any S1/S2 incident or major system change. Record each review in §11.
- Run a tabletop exercise at least once a year (for example "leaked SP-API refresh token").
- At every review, confirm: the role holders and contacts, that `security@amazon.com` is still the correct address, that alerting still works (Suricata, ClamAV, Fail2Ban), and that backups restore.

## 10. Incident record template

Keep one record per incident in `/root/incident-records/` (mode 700) or the company's private document store.

```
Incident ID:
Detected (T0):                 Reported by:
Severity:                      Amazon Information involved? (Y/N/Unknown)
Summary:
Timeline (UTC+2/3):
Evidence collected (paths + SHA-256):
Containment actions:
Credentials rotated (name + time, never values):
Eradication:
Recovery:
Notifications sent (to / time / by):  security@amazon.com: ____
Root cause:
Corrective actions (owner / due):
Closed by / date:
```

## 11. Review log

| Date | Reviewer | Changes |
|---|---|---|
| 2026-09-16 | Security Incident Lead | Initial version |
| _2027-03-16_ | | _Scheduled 6-month review_ |

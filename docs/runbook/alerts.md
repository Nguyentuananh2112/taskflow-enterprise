# Runbook: setting up email alerts (Sentry + uptime monitor)

**For:** the project owner, who sets these up on each service's dashboard. The team does **not** create accounts or enter credentials on your behalf.
**Basis:** ADR-073 (free-tier Sentry + email alerts), `docs/design/devops.md` §6.3–6.5, T-035.
**Do this:** once, when choosing hosting (Phase 5), before the first production deploy.

---

## 0. What the code already provides

| Part | Status in code | What you need to provide |
|---|---|---|
| Sentry API | `@sentry/node`. Sends only 5xx errors and uncaught exceptions; `release` = `GIT_SHA`, `environment` = `APP_ENV`. | `SENTRY_DSN` for the API service |
| Sentry web | `@sentry/nextjs`. Events go through `/monitoring` (same origin), so the CSP doesn't need loosening. | `SENTRY_DSN` for the web service |
| Data sent | Allow-list: no email, password hash, token, cookie, body or query string (tested with real DB errors). | none |
| Missing DSN | The app **still starts** and logs the warning `observability.sentry_disabled_missing_dsn`. | none |
| Metrics | `/metrics` (Prometheus) on **internal port** `METRICS_PORT` (default 9464), Bearer `METRICS_TOKEN`. | Do NOT expose this port to the Internet |

> The DSN is not a secret in the strict sense (it only allows *sending* events), but the repo is public, so set it through the hosting platform's environment variables and never commit it.

---

## 1. Sentry (errors)

### 1.1 Create the project (once)
1. Sign in to Sentry (free plan) with **your** account.
2. Create an organization if you don't have one.
3. Create **2 projects**:
   - `taskflow-api` with platform **Node.js**;
   - `taskflow-web` with platform **Next.js**.
   Two separate projects keep quotas and alerts independent.
4. In each project, open **Settings → Client Keys (DSN)** and copy the DSN.
5. Set the DSNs on the hosting platform:
   - API service: `SENTRY_DSN=<taskflow-api DSN>`;
   - Web service: `SENTRY_DSN=<taskflow-web DSN>`;
   - both services: `GIT_SHA` (CI sets it at build time) and `APP_ENV=staging|production`.

### 1.2 Data protection settings on the project (second layer)
For **each** project, under **Settings → Security & Privacy**:
- turn on **Data Scrubber** and **Use Default Scrubbers**;
- turn on **Prevent Storing of IP Addresses**;
- under **Additional Sensitive Fields**, add: `email`, `password`, `passwordHash`, `token`, `cookie`, `authorization`.

The code already filters this data before sending; this is defence in depth in case of a regression.

### 1.3 Email alerts
In each project, **Alerts → Create Alert → Issues**:

| Alert | Condition | Action |
|---|---|---|
| New issue | "A new issue is created", environment = `production` | Email to the owner + Tech Lead |
| Spike | "Number of events in an issue is more than **50** in **5 minutes**", environment = `production` | Email |
| Regression | "An issue changes state from resolved to unresolved" | Email |

Also set up **Settings → Spike Protection** so a burst doesn't use up the monthly quota.

### 1.4 Quota (free plan)
- `SENTRY_TRACES_SAMPLE_RATE` (API) defaults to **0.05**. Lower it to 0.01 if usage nears the limit (**Stats** page).
- The web app doesn't sample traces (`tracesSampleRate: 0`). It sends errors only.

### 1.5 Check after setup
1. Staging: call a route that causes a 5xx (or temporarily use an API build with a test route). The event should show up in `taskflow-api` within 1 minute.
2. Open the event and confirm there is **no** email, token or query string. Only `reqId`, the error name and code, and a stack trace should be there.
3. Web: open the browser console, run `throw new Error('sentry-check')`, and confirm the event appears in `taskflow-web`. In DevTools → Network, the request should go to `/monitoring` on the same domain.

---

## 2. Uptime monitor (free, independent of the hosting)

Choose a monitoring service whose free plan has email alerts and 1–5 minute intervals.

| Monitor | URL | Condition | Why |
|---|---|---|---|
| API liveness | `https://<api-domain>/healthz` | HTTP 200, 2 consecutive failures then email | public, doesn't touch the DB; detects the process or edge being down |
| Web | `https://<web-domain>/api/healthz` | HTTP 200 | web container |
| TLS | the 2 domains above | certificate expires in < 14 days | built into most monitors |

**About `/readyz`:** the ticket asks for the uptime monitor to point at `/readyz`. However, T-031 (M2) recommends **blocking `/readyz` from the Internet** (load balancer / internal network only), and `/readyz` is limited to 60 requests per minute per IP. Options:
- **(recommended)** The external monitor watches `/healthz`. The hosting platform's health check (internal) uses `/readyz`, so a DB outage takes the instance out of rotation and the platform alerts. On top of that, you get Sentry's 5xx-spike alert.
- If the platform supports **IP allow-listing**, you can expose `/readyz` only to the monitor's IP range, with an interval of at least 1 minute (well under the 60 per minute limit).

Notification channel: **email** (ADR-073). Add both the owner's and the Tech Lead's addresses.

---

## 3. Metrics (Phase 5, optional by platform)
- `/metrics` is served **only** on internal port 9464 (`METRICS_PORT`), separate from the public API port. Do not map this port to a public domain.
- If the platform has no internal network that can scrape it, keep the port closed and set `METRICS_TOKEN` (required in production) as a second layer, then scrape with `Authorization: Bearer <token>`.
- The metrics available are listed in `devops.md` §6.4. Thresholds for alerts (5xx rate, P95, pool, jobs) are in §6.5; configure them in whichever scraping tool you choose.

---

## 4. When you receive an alert email
1. **New issue / spike in Sentry:** open the issue and look at the `reqId` tag. Search the logs for that `reqId`; every log line in a request has `reqId` and `ip` (T-031). That gives you the full request.
2. **Uptime `/healthz` failing:** check the hosting platform (instance status, crash loop), then the logs from the last minutes before the outage.
3. Record the incident in `docs/runbook/` if it is new.

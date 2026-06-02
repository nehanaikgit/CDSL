# CDSL Operations Dashboard

Internal operations tracking and process automation dashboard for the GEPL Capital Depository team. Built to replace manual Google Apps Script workflows with a modern, reliable, and scalable system.

---

## Overview

The CDSL Operations Dashboard tracks daily FMS (File Management System) processes across the Depository department. Each process consists of steps that need to be completed by specific team members within defined SLA times.

Key features:
- Live dashboard showing today's process steps and their status
- Automatic assignment based on live attendance from HRMantra (buddy logic)
- SLA tracking with overdue alerts
- Full audit trail of who did what and when
- Generic architecture — one codebase handles all 23 FMS processes

---


## Architecture

React (Vite)
↓
Node.js + Express (Cloud Run)
↓
Google BigQuery (asia-south1)
↓
HRMantra / universal-table-store (US)
### BigQuery Datasets

| Dataset | Region | Purpose |
|---|---|---|
| CDSL_CONFIG | asia-south1 | step_master, process_master, buddy_master |
| CDSL_RUNTIME | asia-south1 | process_tracker, stored procedures |
| CDSL_REPORTING | asia-south1 | views for dashboard |
| CDSL_LOGS_NEW | asia-south1 | audit log |
| CDSL_ARCHIVE | US | archived process data |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router v7 |
| Backend | Node.js, Express |
| Database | Google BigQuery |
| Hosting | Google Cloud Run |
| Scheduling | Google Cloud Scheduler |
| Auth (planned) | Google OAuth |

---

## Project Structure
CDSL/
├── backend/
│   ├── config/
│   │   └── bigQueryClient.js
│   ├── controllers/
│   │   └── processController.js
│   ├── middleware/
│   │   └── errorHandler.js
│   ├── routes/
│   │   └── processRoutes.js
│   ├── services/
│   │   └── processService.js
│   └── server.js
├── src/
│   ├── assets/
│   │   └── gepl-logo.jpg
│   ├── components/
│   │   └── Logo.jsx
│   ├── pages/
│   │   ├── ProcessDashboard.jsx
│   │   └── ProcessDashboard.css
│   ├── services/
│   │   └── apiClient.js
│   ├── utils/
│   │   └── processUtils.js
│   ├── App.jsx
│   └── main.jsx
├── .github/
│   └── workflows/
│       └── cdsl-ci.yml
└── package.json
---

## FMS Processes

| Process Code | Process Name | Steps | Status |
|---|---|---|---|
| ST_BOD_FMS | File Download BOD FMS | 13 | ✅ Live |
| More coming | — | — | ⏳ Pending |

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | /health | Health check |
| GET | /api/process/:processCode | Get all steps for latest day |
| GET | /api/process/:processCode/steps/:stepId | Get single step |
| POST | /api/process/:processCode/init | Initialize today's rows |
| POST | /api/process/:processCode/archive | Archive a day |
| PATCH | /api/process/:processCode/steps/:stepId/status | Update step status |
| GET | /api/process/:processCode/audit | Full audit log |
| GET | /api/process/:processCode/steps/:stepId/audit | Step audit log |

---

## Buddy Assignment Logic

On every dashboard load, the backend queries HRMantra live to determine who is assigned to each step:

| Condition | Assignment | Label |
|---|---|---|
| Owner present and not on leave | Owner | SELF |
| Owner absent, buddy present | Buddy | BUDDY |
| Owner + buddy absent, RM present | Reporting Manager | REPORTING |
| All absent | systems@geplcapital.com | ADMIN |

---

## Environment Variables

Create `backend/.env`:

PORT=5001
BQ_LOCATION=asia-south1
GCP_PROJECT_ID=gepl-operations
BQ_DATASET_REPORTING=CDSL_REPORTING
BQ_DATASET_RUNTIME=CDSL_RUNTIME

---

## Local Development

```bash
# Install dependencies
pnpm install

# Start backend
cd backend && pnpm dev

# Start frontend (new terminal)
cd .. && pnpm dev
```

Frontend: http://localhost:5173
Backend: http://localhost:5001

---

## Deployment

Backend deploys to Google Cloud Run:

```bash
cd backend
gcloud run deploy cdsl-backend \
  --source . \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated
```

---

## Pending

- [ ] Cloud Run deployment
- [ ] Cloud Scheduler (auto init 8 AM, archive 6 PM)
- [ ] Google Chat notifications
- [ ] Seed remaining 22 FMS
- [ ] Google OAuth authentication
- [ ] File watcher (auto-mark steps when file arrives)
- [ ] Manager overview dashboard


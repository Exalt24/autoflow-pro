# Local setup

Everything below runs on your machine with no cloud account. It was run on Windows 11 with Node 24 and Docker Desktop.

### Prerequisites

- Node.js 22 or newer
- Docker Desktop (running)

### Local development

1. Clone the repository and start Redis:

```bash
git clone https://github.com/Exalt24/autoflow-pro.git
cd autoflow-pro
docker compose up -d redis
```

2. Start a local Supabase stack from the repo root. The repo carries its own `supabase/config.jsonc` (project id `autoflow-pro`): studio, analytics, realtime, the mail server and the vector service are switched off because the app uses none of them, and the edge runtime is on for the `execution-summary` function (`supabase/functions/`, tested by `npm run test:edge`).

```bash
npx supabase start -x imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor,realtime
npx supabase status -o env
```

   `status -o env` prints `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`, which the two env files below need.

3. Create the tables, policies and storage buckets with the repo's migration. The database container is named `supabase_db_` plus the project id from `supabase/config.jsonc`, so `supabase_db_autoflow-pro`. This file deletes every user and all storage objects first, so only run it against a local stack. From the repo root, in bash:

```bash
docker exec -i supabase_db_autoflow-pro psql -U postgres -v ON_ERROR_STOP=1 < backend/migrations/001_initial_schema.sql
docker exec -i supabase_db_autoflow-pro psql -U postgres -v ON_ERROR_STOP=1 < backend/migrations/002_gdpr_data_subject_requests.sql
```

   or in PowerShell:

```powershell
Get-Content backend\migrations\001_initial_schema.sql -Raw | docker exec -i supabase_db_autoflow-pro psql -U postgres -v ON_ERROR_STOP=1
Get-Content backend\migrations\002_gdpr_data_subject_requests.sql -Raw | docker exec -i supabase_db_autoflow-pro psql -U postgres -v ON_ERROR_STOP=1
```

   The second file adds the erasure audit table and the log retention function (see the GDPR notes in the README) and is safe to run again. (The hosted version applied the first file through the Supabase SQL editor.)

4. Set up the backend:

```bash
cd ../autoflow-pro/backend
npm install
npx playwright-core install chromium
cp .env.example .env
```

   In `.env` set `SUPABASE_URL` (the `API_URL`), `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (the `SERVICE_ROLE_KEY`), `REDIS_URL=redis://127.0.0.1:6379` and `CORS_ORIGIN=http://localhost:3000`. Delete the four `CLOUDFLARE_R2_*` lines (the example file holds placeholders, and archival is skipped when the R2 credentials are missing). Then:

```bash
npm run dev
```

5. Set up the frontend in a new terminal:

```bash
cd autoflow-pro/frontend   # from the folder that holds the repo
npm install
cp .env.example .env.local
```

   In `.env.local` set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the same values as above, and leave the API and WebSocket URLs pointing at the backend. Then:

```bash
npm run dev
```

6. Open the app:

- Frontend: http://localhost:3000, then **Sign up** to create an account
- Backend: http://localhost:4000
- Health check: http://localhost:4000/health

To try a workflow without touching a third-party site, serve any small HTML page on your machine and point a Navigate step at it. The recording uses a one-file catalog page with a search box: Navigate, Fill the box, Click Search, Wait, Extract the titles and the prices, Screenshot.

### Environment variables

See the `.env.example` files in `backend/` and `frontend/`. A local run needs the Supabase URL and keys, a Redis URL and a CORS origin. The Cloudflare R2 credentials are only needed if you want archival.

### Good to know

- The API allows 100 requests per 15 minutes per client, counted in the backend process. Clicking around the dashboard for a while can hit it ("Rate limit exceeded"); restarting the backend clears the counter.
- Stop the local Supabase stack with `npx supabase stop` from the repo root, and Redis with `docker compose down`.
- The edge function tests need the stack above and these three variables, taken from `npx supabase status -o env`: `SUPABASE_URL` (the `API_URL`), `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_KEY` (the `SERVICE_ROLE_KEY`). Then `cd backend && npm run test:edge`. Without them only the pure logic part runs and says so. The personal data tests (`npm run test:gdpr`) need the same three variables, both migrations and Docker, because they search every table through `docker exec` into the database container (`supabase_db_autoflow-pro`, or the name in `SUPABASE_DB_CONTAINER`).

## What a workflow can do

- Navigate to URLs, click elements and fill forms
- Extract data and take screenshots
- Execute JavaScript
- Branch on conditions and loop
- Set and read variables
- Download files
- Manage cookies and localStorage

### Scheduling

- Cron-based scheduling with presets (daily, weekly, monthly)
- Next run time preview and execution history
- Failure monitoring with auto-pause after consecutive failures

### Analytics

- Execution volume trends, success rates and error analysis
- Resource usage view
- Retention policy of 7, 30 or 90 days (default 30)

### Real-time

- Live execution monitoring with streaming logs and progress
- WebSocket connection with automatic reconnection


## Security notes

- Helmet security headers
- Input sanitization
- Rate limiting (100 requests per 15 minutes)
- Row Level Security on Supabase tables, so each user sees only their own rows

The data model is per-user rows with RLS, not a multi-tenant system with organizations or workspaces.


## Project structure

```
autoflow-pro/
├── frontend/           # Next.js application
│   ├── app/            # App Router pages
│   ├── components/     # React components
│   ├── lib/            # Utilities and API client
│   └── types/          # TypeScript types
├── backend/            # Fastify API server
│   ├── src/
│   │   ├── api/        # API route handlers
│   │   ├── config/     # Configuration modules
│   │   ├── middleware/ # Security and validation
│   │   ├── services/   # Business logic
│   │   ├── types/      # TypeScript types
│   │   ├── utils/      # Utilities
│   │   └── websocket/  # WebSocket handlers
│   └── migrations/     # Database migrations
└── docs/               # Documentation
```


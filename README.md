# AutoFlow Pro

![AutoFlow Pro running on a local stack: sign in, build a workflow by dragging steps onto the canvas, run it, watch the logs stream, read the extracted data](docs/demo.gif)

*Recorded against a local stack (Supabase CLI, Redis in Docker, a test page served from the same machine). It plays at 2x except for the live run.*

A browser automation platform with a drag-and-drop workflow builder, a Redis-backed job queue, live execution monitoring and cron scheduling. You build a workflow out of steps (navigate, click, fill, extract and so on), and a Playwright worker runs it while the dashboard streams the logs over WebSocket. Every row is scoped to its owner with Supabase Row Level Security. When it was hosted it ran on free tiers (Vercel, Render, Supabase, Upstash, Cloudflare R2); locally it needs only Docker and Node.

## Demo

The hosted copy is offline: the free-tier host suspended its services in October 2026, so the links that used to be here led to empty pages and were removed. The recording above is the real app on a local stack, and the steps below rebuild that stack. The app has a sign-up page and no shared demo account, so locally you create your own; a local Supabase has email confirmation off, so you land on the dashboard straight after signing up.

## Features

- Visual workflow builder: drag-and-drop with React Flow
- 23 automation step types: navigate, click, fill, extract, loops, conditionals and more
- Scheduled jobs: cron-based runs with failure monitoring
- Real-time monitoring: WebSocket updates while a workflow runs
- Analytics dashboard: execution trends, success rates and error analysis
- Data archival: executions past the retention period are archived to Cloudflare R2 (off unless the R2 credentials are set)
- Usage view: the dashboard shows usage against per-user quota rows (10 workflows and 50 executions a month are the defaults it reports; the backend does not enforce them)

## Tech stack

**Frontend**

- Next.js 16 (App Router)
- React 19
- TypeScript 5.9
- Tailwind CSS 4
- React Flow (`@xyflow/react`) for the builder
- Recharts for analytics
- Socket.IO client for live updates

**Backend**

- Node.js 22
- Fastify 5
- TypeScript 5.9
- Playwright (`playwright-core` 1.58) for browser automation
- BullMQ 5 for the job queue
- Socket.IO 4.8 for WebSocket

**Database and storage**

- Supabase (PostgreSQL, Auth, Storage)
- Redis for the queue and cache (Upstash when hosted, a Docker container locally)
- Cloudflare R2 for archival (optional)

## Quick start

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

2. Start a local Supabase stack from a folder next to the repo (the Supabase CLI keeps its own project files):

```bash
cd ..
mkdir autoflow-supabase
cd autoflow-supabase
npx supabase init
```

   In `supabase/config.toml`, set `enabled = false` under `[studio]`, `[analytics]` and `[edge_runtime]` (the app uses none of them and the recording was made without them). Then:

```bash
npx supabase start
npx supabase status -o env
```

   `status -o env` prints `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`, which the two env files below need.

3. Create the tables, policies and storage buckets with the repo's migration. The database container is named `supabase_db_` plus the CLI project id, which is the folder name from step 2. This file deletes every user and all storage objects first, so only run it against a local stack. From the `autoflow-supabase` folder, in bash:

```bash
docker exec -i supabase_db_autoflow-supabase psql -U postgres -v ON_ERROR_STOP=1 < ../autoflow-pro/backend/migrations/001_initial_schema.sql
```

   or in PowerShell:

```powershell
Get-Content ..\autoflow-pro\backend\migrations\001_initial_schema.sql -Raw | docker exec -i supabase_db_autoflow-supabase psql -U postgres -v ON_ERROR_STOP=1
```

   (The hosted version applied the same file through the Supabase SQL editor.)

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
- Stop the local Supabase stack with `npx supabase stop` from the folder you started it in, and Redis with `docker compose down`.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the deployment steps. The hosted copy used:

- Frontend: Vercel (free tier)
- Backend: Render (free tier, Singapore region)
- Database: Supabase (free tier)
- Queue: Upstash Redis (free tier)
- Storage: Cloudflare R2 (free tier)

## Documentation

- [API reference](docs/API.md)
- [User guide](docs/USER_GUIDE.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md)

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

## Testing

There are 29 backend test scripts in `backend/tests/`, each run with `tsx`, and no frontend tests. They are scripts that print their results rather than a test-framework suite, and most need real Supabase, Redis and, for the browser ones, Playwright browsers configured.

```bash
# Backend scripts (examples)
cd backend
npm run test:connection    # database connection
npm run test:queue         # queue operations
npm run test:automation    # browser automation
npm run test:api           # API endpoints
npm run test:websocket     # WebSocket server

# Frontend
cd frontend
npm run lint               # ESLint
npx tsc --noEmit           # TypeScript check
```

The full list of test scripts is in `backend/package.json`.

### Building

```bash
cd backend
npm run build              # compile TypeScript

cd frontend
npm run build              # production build
```

## Security

- Helmet security headers
- Input sanitization
- Rate limiting (100 requests per 15 minutes)
- Row Level Security on Supabase tables, so each user sees only their own rows

The data model is per-user rows with RLS, not a multi-tenant system with organizations or workspaces.

## Monitoring

- Health check endpoint
- Resource tracking in the dashboard
- Error logging with Pino

## License

MIT. See the LICENSE file.

## Support

- Documentation: [docs/](docs/)
- Issues: GitHub Issues
- Troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Built with

[Next.js](https://nextjs.org/), [Fastify](https://fastify.io/), [Playwright](https://playwright.dev/), [React Flow](https://reactflow.dev/), [Supabase](https://supabase.com/) and [BullMQ](https://docs.bullmq.io/).

# AutoFlow Pro

A browser automation platform with a drag-and-drop workflow builder, a Redis-backed job queue, live execution monitoring and cron scheduling. You build a workflow out of steps (navigate, click, fill, extract and so on), and a Playwright worker runs it while the dashboard streams the logs over WebSocket. Every row is scoped to its owner with Supabase Row Level Security. The backend, queue and storage all run on free tiers.

## Live demo

- Frontend: https://autoflow-pro.vercel.app
- Backend API: https://autoflow-pro-api.onrender.com
- Health check: https://autoflow-pro-api.onrender.com/health

The demo opens on a sign-in wall. There is a sign-up page, and no demo account is documented in this repo, so sign-in is required to see anything past the landing page.

The backend runs on Render's free tier and sleeps after a period of inactivity. The first request can take up to a minute to wake it, and it may be down if the free instance is spun down. Run the backend locally (see Quick start) for a reliable environment.

## Features

- Visual workflow builder: drag-and-drop with React Flow
- 23 automation step types: navigate, click, fill, extract, loops, conditionals and more
- Scheduled jobs: cron-based runs with failure monitoring
- Real-time monitoring: WebSocket updates while a workflow runs
- Analytics dashboard: execution trends, success rates and error analysis
- Data archival: executions past the retention period are archived to Cloudflare R2
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
- Upstash Redis for the queue and cache
- Cloudflare R2 for archival

## Quick start

### Prerequisites

- Node.js 22
- A Supabase account
- An Upstash Redis account
- A Cloudflare R2 account

### Local development

1. Clone the repository:

```bash
git clone https://github.com/Exalt24/autoflow-pro.git
cd autoflow-pro
```

2. Set up the backend:

```bash
cd backend
npm install
cp .env.example .env
# Fill in environment variables
npm run dev
```

3. Set up the frontend in a new terminal:

```bash
cd frontend
npm install
cp .env.example .env.local
# Fill in environment variables
npm run dev
```

4. Open the app:

- Frontend: http://localhost:3000
- Backend: http://localhost:4000
- Health check: http://localhost:4000/health

### Environment variables

See the `.env.example` files in `backend/` and `frontend/`. You need the Supabase URL and keys, the Upstash Redis URL, the Cloudflare R2 credentials and a CORS origin.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the deployment steps. The live demo uses:

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

This repo has no keep-alive workflow. A scheduled GitHub Actions job that calls `/health` every few minutes would keep the free Render instance awake. I had one earlier and removed it.

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

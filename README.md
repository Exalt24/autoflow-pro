# AutoFlow Pro - Browser Automation Platform

Complete full-stack browser automation platform with visual workflow builder, distributed job queue, real-time monitoring, and multi-tenant architecture.

## Tech Stack

### Frontend

- Next.js 15 (App Router)
- React 19
- TypeScript 5.9+
- Tailwind CSS 4.1
- React Flow (visual workflow builder)
- Recharts 3.3+ (analytics)
- Socket.IO Client 4.8+

### Backend

- Node.js 22 LTS
- Fastify 5.x
- TypeScript 5.9+
- Playwright 1.48+ (browser automation)
- BullMQ 5.x (job queue)
- Socket.IO 4.8+ (WebSocket)

### Database & Storage

- Supabase (PostgreSQL 15 + Auth + Storage)
- Upstash Redis (queue/cache)
- Cloudflare R2 (cold storage)

## Project Structure

```
autoflow-pro/
├── frontend/          # Next.js 15 application
│   ├── app/          # App Router pages
│   ├── components/   # React components
│   ├── lib/          # Utilities and API client
│   └── types/        # TypeScript types
├── backend/          # Fastify API server
│   ├── src/
│   │   ├── api/      # Route handlers
│   │   ├── config/   # Configuration
│   │   ├── services/ # Business logic
│   │   ├── types/    # TypeScript types
│   │   └── websocket/# WebSocket handlers
│   └── migrations/   # Database migrations
└── docker-compose.yml # Local development (optional)
```

## Getting Started

### Prerequisites

- Node.js 22 LTS or higher
- npm or yarn
- Docker (optional, for local PostgreSQL/Redis)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd autoflow-pro
```

2. Install frontend dependencies:

```bash
cd frontend
npm install
cp .env.example .env.local
```

3. Install backend dependencies:

```bash
cd ../backend
npm install
cp .env.example .env
```

4. Configure environment variables:
   - Update `frontend/.env.local` with your Supabase credentials
   - Update `backend/.env` with your Supabase and Upstash credentials

### Development

Run frontend (port 3000):

```bash
cd frontend
npm run dev
```

Run backend (port 4000):

```bash
cd backend
npm run dev
```

Optional - Run local PostgreSQL/Redis with Docker:

```bash
docker-compose up -d
```

### Building for Production

Frontend:

```bash
cd frontend
npm run build
npm start
```

Backend:

```bash
cd backend
npm run build
npm start
```

## Features

- ✅ Visual workflow builder with drag-and-drop
- ✅ Browser automation with Playwright
- ✅ Real-time execution monitoring
- ✅ Scheduled jobs with cron expressions
- ✅ Data extraction and export
- ✅ Multi-tenant architecture with RLS
- ✅ Analytics dashboard
- ✅ Automatic data archival

## Development Status

Phase 0: ✅ Complete - Project setup and dependencies
Phase 1: ⏳ In Progress - Supabase setup and database schema
Phase 2-10: 📋 Planned

## License

MIT

## Contributing

Contributions welcome! Please read CONTRIBUTING.md for guidelines.

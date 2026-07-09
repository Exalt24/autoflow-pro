# AutoFlow Pro - Frontend

The web UI for AutoFlow Pro: a Next.js (App Router) application where users build browser-automation workflows on a drag-and-drop canvas, schedule them, and watch executions stream in live.

Built with Next.js, React, TypeScript, and Tailwind CSS. The visual builder uses React Flow, analytics charts use Recharts, and real-time execution updates arrive over Socket.IO. It talks to the Fastify backend in `../backend`.

## Getting Started

```bash
npm install
cp .env.example .env.local   # fill in the backend URL and Supabase keys
npm run dev
```

The app runs at http://localhost:3000 and expects the backend on http://localhost:4000.

## Scripts

- `npm run dev` - start the dev server
- `npm run build` - production build
- `npm start` - serve the production build
- `npm run lint` - run ESLint

## Structure

- `app/` - App Router pages
- `components/` - React components (workflow builder, dashboard, UI)
- `contexts/`, `hooks/` - shared state and hooks
- `lib/` - API client, WebSocket client, utilities
- `types/` - shared TypeScript types

See the [root README](../README.md) for the full stack, deployment, and feature overview.

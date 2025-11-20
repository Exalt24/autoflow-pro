# AutoFlow Pro

Complete full-stack browser automation platform with visual workflow builder, distributed job queue, real-time monitoring, and multi-tenant architecture.

## Features

- **Visual Workflow Builder**: Drag-and-drop interface with React Flow
- **23 Automation Steps**: Navigate, click, fill, extract, loops, conditionals, and more
- **Scheduled Jobs**: Cron-based automation with failure monitoring
- **Real-Time Monitoring**: WebSocket live updates during execution
- **Analytics Dashboard**: Execution trends, success rates, error analysis
- **Data Archival**: Automatic archival to Cloudflare R2 after retention period
- **Resource Monitoring**: Track usage against free tier limits

## Tech Stack

**Frontend**:

- Next.js 15 (App Router)
- React 19
- TypeScript 5.9+
- Tailwind CSS 4
- React Flow (visual builder)
- Recharts (analytics)
- Socket.IO Client (real-time)

**Backend**:

- Node.js 22 LTS
- Fastify 5.x
- TypeScript 5.9+
- Playwright 1.48+ (browser automation)
- BullMQ 5.x (job queue)
- Socket.IO 4.8+ (WebSocket)

**Database & Storage**:

- Supabase (PostgreSQL 15, Auth, Storage)
- Upstash Redis (queue & cache)
- Cloudflare R2 (archival)

## Quick Start

### Prerequisites

- Node.js 22 LTS
- npm or yarn
- Supabase account
- Upstash Redis account
- Cloudflare R2 account

### Local Development

1. **Clone repository**:

```bash
git clone https://github.com/YOUR_USERNAME/autoflow-pro.git
cd autoflow-pro
```

2. **Setup backend**:

```bash
cd backend
npm install
cp .env.example .env
# Fill in environment variables
npm run dev
```

3. **Setup frontend** (in new terminal):

```bash
cd frontend
npm install
cp .env.example .env.local
# Fill in environment variables
npm run dev
```

4. **Access application**:

- Frontend: http://localhost:3000
- Backend: http://localhost:4000
- Health Check: http://localhost:4000/health

### Environment Variables

See `.env.example` files in `backend/` and `frontend/` directories.

**Required**:

- Supabase URL, keys
- Upstash Redis URL
- Cloudflare R2 credentials
- CORS origin

## Deployment

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for complete deployment guide.

**Services**:

- Frontend: Vercel (free tier)
- Backend: Render (free tier - Singapore region)
- Database: Supabase (free tier)
- Queue: Upstash Redis (free tier)
- Storage: Cloudflare R2 (free tier)
- Monitoring: UptimeRobot (free tier)

## Documentation

- **[API Reference](docs/API.md)**: Complete API documentation
- **[User Guide](docs/USER_GUIDE.md)**: How to use AutoFlow Pro
- **[Deployment Guide](docs/DEPLOYMENT.md)**: Production deployment steps
- **[Troubleshooting](docs/TROUBLESHOOTING.md)**: Common issues and solutions
- **[Contributing](CONTRIBUTING.md)**: How to contribute

## Project Structure

```
autoflow-pro/
├── frontend/           # Next.js application
│   ├── app/           # App Router pages
│   ├── components/    # React components
│   ├── lib/           # Utilities and API client
│   └── types/         # TypeScript types
├── backend/           # Fastify API server
│   ├── src/
│   │   ├── api/       # API route handlers
│   │   ├── config/    # Configuration modules
│   │   ├── middleware/# Security and validation
│   │   ├── services/  # Business logic
│   │   ├── types/     # TypeScript types
│   │   ├── utils/     # Utilities
│   │   └── websocket/ # WebSocket handlers
│   └── migrations/    # Database migrations
├── docs/              # Documentation
└── monitoring/        # Monitoring setup guides
```

## Key Features

### Workflow Automation

- Navigate to URLs
- Click elements
- Fill forms
- Extract data
- Take screenshots
- Execute JavaScript
- Conditional logic
- Loops and iterations
- Variable management
- File downloads
- Cookie/localStorage management

### Scheduling

- Cron-based scheduling
- Presets (daily, weekly, monthly)
- Next run time preview
- Execution history
- Failure monitoring
- Auto-pause after consecutive failures

### Analytics

- Execution volume trends
- Success rate tracking
- Error analysis
- Performance insights
- Resource usage monitoring
- Retention policy configuration

### Real-Time Features

- Live execution monitoring
- Streaming logs
- Progress indicators
- WebSocket connection
- Automatic reconnection

## Free Tier Limits

- **Workflows**: 10 maximum
- **Executions**: 50 per month
- **Storage**: 1GB total
- **Retention**: 7/30/90 days options
- **Execution Time**: 15 minutes max per workflow

## Development

### Testing

```bash
# Backend tests
cd backend
npm run test:connection    # Database connection
npm run test:queue        # Queue operations
npm run test:automation   # Browser automation
npm run test:api          # API endpoints
npm run test:websocket    # WebSocket server

# Frontend
cd frontend
npm run lint              # ESLint
npx tsc --noEmit         # TypeScript check
```

### Building

```bash
# Backend
cd backend
npm run build            # Compile TypeScript

# Frontend
cd frontend
npm run build            # Production build
```

## Performance

- **Page Load**: <3 seconds
- **API Response**: <500ms
- **WebSocket Latency**: <100ms
- **Cache Hit Rate**: >70%

## Security

- Helmet security headers
- Input sanitization
- XSS prevention
- Rate limiting (100 req/15min)
- Row Level Security (Supabase)
- HTTPS enforced (production)

## Monitoring

- Health check endpoints
- System metrics
- Resource tracking
- UptimeRobot monitoring
- Error logging with Pino

## License

MIT License - see LICENSE file for details

## Support

- **Documentation**: [docs/](docs/)
- **Issues**: GitHub Issues
- **Troubleshooting**: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Acknowledgments

Built with:

- [Next.js](https://nextjs.org/)
- [Fastify](https://fastify.io/)
- [Playwright](https://playwright.dev/)
- [React Flow](https://reactflow.dev/)
- [Supabase](https://supabase.com/)
- [BullMQ](https://docs.bullmq.io/)

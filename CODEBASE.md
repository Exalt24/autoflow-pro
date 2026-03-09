AUTOFLOW PRO INTERVIEW CHEAT SHEET


WHAT IS IT

AutoFlow Pro is a full-stack browser automation platform. Users build workflows visually with a drag-and-drop node editor, schedule them with cron expressions, and monitor executions in real time via WebSocket. Think Zapier meets Selenium, but self-hosted and built for power users who need fine-grained browser control.


WHY FASTIFY OVER EXPRESS?

I went with Fastify 5 because it has built-in schema validation, a plugin system that handles encapsulation properly, and it's significantly faster than Express for JSON serialization. In benchmarks, Fastify handles roughly 30,000 requests/second compared to Express's 15,000. That's a 2x difference that translates directly to infrastructure cost, since Fastify needs about half the compute for the same throughput.

But honestly, at my scale on Render's free tier, the performance gap wasn't the main driver. What sold me was the developer experience. Fastify's hook lifecycle (onRequest, preHandler, onResponse) gave me cleaner middleware composition than Express's linear middleware chain. I use onRequest for request timing and input sanitization, and onResponse for structured logging with Pino. The rate limiting plugin (@fastify/rate-limit) and Helmet integration (@fastify/helmet) were drop-in, no extra wiring needed. With Express I'd be pulling in helmet, express-rate-limit, and manually wiring them, which is fine but more boilerplate for the same result.

I did consider Hono, which is the new darling of the Node.js world. Hono is even lighter than Fastify and runs everywhere (edge, serverless, Bun, Deno). But Hono's ecosystem in late 2025 was still maturing for traditional server deployments. I needed a battle-tested plugin system for things like WebSocket integration, file uploads, and rate limiting. Fastify had all of that out of the box. If I were building a serverless API or deploying to Cloudflare Workers, Hono would be the obvious pick. For a long-running server process managing browser instances and Redis connections, Fastify was the pragmatic choice.

Limitation: Fastify's plugin encapsulation can be confusing when you first hit it. Decorators registered in one plugin aren't visible in sibling plugins unless you register them at the right scope. I spent a few hours debugging why my Supabase client wasn't available in certain routes before understanding the encapsulation model. Express's flat middleware approach is simpler to reason about for beginners, and that's a real trade-off.

I set a 1MB body limit to prevent payload abuse since workflow definitions are JSON but shouldn't be massive. At scale, I'd probably move to request validation with JSON Schema (which Fastify supports natively) on every route, but right now only the critical endpoints have schemas defined.


WHY PLAYWRIGHT OVER PUPPETEER OR SELENIUM?

Playwright was a deliberate choice, not just "it's newer so it's better." The main reasons were auto-waiting semantics, the playwright-core split, and cross-browser support. But let me break down the actual trade-offs.

Playwright's auto-waiting is genuinely better than Puppeteer's. When I call page.waitForSelector, it handles the polling internally with configurable states (visible, hidden, attached). Puppeteer can do similar things but Playwright's API is more consistent across operations. More importantly, Playwright's locator API (page.getByRole, page.getByText) reduces flaky selectors. I'm not using locators as heavily as I should since my step configs use CSS selectors from user input, but the foundation is there.

The big win was playwright-core, which is the library without bundled browsers. In production I connect to a remote Chrome instance via CDP (connectOverCDP) using the BROWSER_WS_URL environment variable, so I'm not shipping a 400MB Chromium binary with my deployment. Locally it launches headless Chromium with stealth args. This split doesn't exist cleanly in Puppeteer. You either install puppeteer (with Chromium) or puppeteer-core, but the CDP connection API isn't as polished.

Selenium was never seriously considered. It's great for enterprise cross-browser testing suites where you need the Selenium Grid infrastructure and broad language support, but for a Node.js automation platform it's heavy. The WebDriver protocol adds a network hop that CDP doesn't have, which means more latency per browser command. Playwright talks to the browser directly via CDP or their custom protocol, cutting out that middleman. In 2025/2026, Selenium still dominates enterprise test automation because of institutional momentum, but for greenfield projects Playwright is the consensus recommendation.

What I'd do differently: I'd explore browser-as-a-service providers more seriously. Services like Browserless and Steel handle browser lifecycle, anti-detection, and scaling for you. I already support remote browsers via BROWSER_WS_URL, so switching to a managed service is a config change, not a code change. The reason I didn't start there is cost, since free tier Render can run a headless Chrome fine for demo purposes. But at any real scale, managing your own browser instances is a pain. Memory leaks, zombie processes, GPU rendering issues. A managed service handles all of that.

Limitation: My AutomationEngine has a maxConcurrent of 2 browsers with a polling wait loop. That's fine for a demo but embarrassing for production. A proper implementation would use a semaphore pattern or browser pool with health checks, not a while loop checking a counter.


HOW DOES THE ANTI-DETECTION / STEALTH WORK?

I built a humanBehavior.ts utility module. The core idea is that bots get detected by predictable timing and fingerprints. Modern anti-bot systems like Cloudflare Turnstile, DataDome, and PerimeterX look at a combination of TLS fingerprints, JavaScript API probing (navigator.webdriver, WebGL rendering, canvas fingerprints), and behavioral patterns (mouse movement entropy, keystroke timing distribution).

My approach covers the behavioral layer but is honest about its limits. I use a Box-Muller transform to generate Gaussian-distributed random delays instead of uniform random. This means most delays cluster around the mean with natural variance, which looks more human than Math.random() between min and max. Specific techniques: character-by-character typing with 40-120ms random delays between keystrokes (humanType), random mouse movements after page loads (randomMouseMove), hover-then-click with small delays instead of instant clicks, and randomized viewport sizes from a pool of common resolutions so it's not always exactly 1920x1080.

On the browser launch side, I disable AutomationControlled blink feature, disable WebRTC hardware encoding to prevent fingerprint leaks, and set locale/timezone context options. When connecting to a remote CDP browser, I skip the custom user agent to let the remote service handle its own fingerprinting.

Why not use an existing stealth library? Puppeteer-extra-plugin-stealth and playwright-stealth exist, but they're community-maintained and can lag behind bot detection updates. More importantly, I wanted to understand what each evasion technique actually does rather than importing a black box. The educational value was part of the point, and in an interview I can explain exactly why I'm using Gaussian delays instead of just saying "I used a stealth plugin."

Ethical framing: This is a self-hosted platform where users automate their own workflows. The anti-detection is meant for legitimate automation (filling out forms on sites you own, scraping public data in compliance with robots.txt, testing your own applications). I'm not building a credential-stuffing tool. The humanBehavior module makes automations less likely to trigger CAPTCHAs on legitimate sites, which is a UX concern, not a circumvention strategy. That said, the techniques are the same ones used by less ethical tools, and I'm aware of that tension. In a production product, I'd add configurable compliance checks (robots.txt parsing, rate limit detection) to guide users toward responsible use.

Limitations: My stealth approach is surface-level compared to dedicated anti-detect browsers like Multilogin or GoLogin, which create entirely separate browser profiles with distinct TLS fingerprints, WebGL hashes, and canvas rendering. I'm modifying a standard Chromium instance's behavior, not its deep fingerprint. Against serious bot detection (Cloudflare Bot Management, Akamai Bot Manager), my approach would likely fail. It's good enough for basic bot detection but not enterprise-grade anti-bot systems. With more time, I'd integrate with a service like Browserless that handles fingerprint management at the infrastructure level.


HOW DOES THE WORKFLOW EXECUTION PIPELINE WORK?

It's fully async and decoupled. When a user hits "Run Workflow," the API creates an execution record in Supabase with status "queued," then enqueues a job to BullMQ via the QueueService. The WorkerProcessor picks it up, instantiates an AutomationEngine, and iterates through the workflow steps sequentially. Each step gets its config run through a variable substitution system first, so you can reference values from previous steps using ${variableName} syntax. The variable substitution supports nested dot-path access (like ${response.data.title}) and handles objects, arrays, and strings recursively. As steps execute, callbacks fire for progress updates, log entries, and step completions. All of these get broadcast over WebSocket in real time to the connected client.

The sequential execution is a deliberate simplification. Real workflow engines like n8n support parallel branches, conditional forks, and sub-workflows. I kept it linear because the visual builder UI maps cleanly to a sequential pipeline, and adding parallel execution would require a DAG scheduler, which is a significant complexity jump. I have conditional and loop steps, so you can do branching logic within a linear flow, but you can't run steps 3 and 4 simultaneously while step 5 waits for both. That's the biggest architectural limitation and would be the first thing I'd tackle in a v2.


WHY BULLMQ OVER A SIMPLE IN-PROCESS QUEUE?

Reliability and concurrency control. BullMQ gives me persistent job storage in Redis, automatic retries with exponential backoff (3 attempts, starting at 60 seconds), and worker concurrency limiting. The worker is configured with concurrency: 2 and a rate limiter of 10 jobs per 60 seconds. If the server crashes mid-execution, the job survives in Redis and gets retried. You can't get that with an in-memory queue.

I considered the alternatives seriously. Temporal is the "right" answer for complex workflow orchestration. It gives you workflow versioning, activity retries, long-running workflow support, and durable execution out of the box. But Temporal requires running its own server cluster (or paying for Temporal Cloud), which is overkill for a free-tier project. Temporal is what I'd reach for if AutoFlow Pro became a real product with paying customers.

Inngest is interesting because it's serverless-native, event-driven, and you define workflows as code with built-in retries and step functions. It would eliminate my need for Redis entirely. But Inngest is a hosted service, and I wanted AutoFlow Pro to be fully self-hostable. Adding a dependency on Inngest's cloud would undermine that goal.

pg-boss was tempting because it uses PostgreSQL as the queue backend, and I'm already running Supabase (Postgres). One less service to manage. There's even a compelling argument from early 2026 that you can replace BullMQ with 60 lines of PostgreSQL using SKIP LOCKED. But pg-boss doesn't match BullMQ's feature set for rate limiting, job prioritization, and repeatable jobs. And Postgres-as-a-queue has known scaling issues when your job table grows large, since it's fighting against Postgres's MVCC model.

BullMQ hit the sweet spot: Redis-backed persistence, battle-tested in production, great TypeScript support, and Upstash gives me a free Redis instance. The trade-off is an additional service dependency (Redis), but that's worth it for the reliability guarantees.

I also track Redis command counts internally for resource monitoring since I'm on Upstash's free tier (10,000 daily commands). Jobs auto-clean after completion (keep last 100 completed, last 50 failed) to prevent unbounded Redis memory growth. At scale, I'd move the auto-clean thresholds up and add dead letter queues for failed jobs that need human review.


HOW DOES THE WEBSOCKET LAYER WORK?

Socket.IO server initialized on the same HTTP server as Fastify. Every connection goes through JWT auth middleware that verifies the Supabase token. Authenticated sockets join a user-specific room (user:{userId}) and can subscribe to execution-specific rooms (execution:{executionId}).

I built three optimization layers: message throttling (max 10 messages/second via a queue that processes one message per 100ms interval), log batching (execution logs accumulate for 1 second then flush as a single batch event), and idle connection cleanup (30-minute timeout with activity tracking via onAny listener). This prevents WebSocket from overwhelming the client during fast-running workflows that produce dozens of log entries per second.

Why Socket.IO over raw ws or uWebSockets? It's a trade-off between features and performance. The raw ws library is faster and lighter, handling 50K+ connections per server with minimal overhead. uWebSockets.js is even faster, 3-8x more concurrent connections than ws, because it's C++ with Node bindings. But both give you just a WebSocket connection, nothing else. You have to build reconnection logic, room management, message acknowledgment, and authentication middleware yourself.

Socket.IO gives me rooms (critical for scoping events to specific users and executions), automatic reconnection with exponential backoff on the client, namespace isolation, and middleware hooks for auth. I estimated I'd spend 2-3 days reimplementing those features on top of ws. Socket.IO gave them to me in an afternoon. The performance cost is real (Socket.IO adds ~2KB overhead per message for its protocol framing, and initial connection does an HTTP long-poll before upgrading to WebSocket), but at my scale of maybe 10-20 concurrent connections, that overhead is irrelevant.

If I were building a real-time system that needed to handle thousands of concurrent connections (like a multiplayer game or a trading platform), I'd use ws or uWebSockets without question. For a workflow monitoring dashboard where maybe 5 people are watching their automations run simultaneously, Socket.IO's DX wins over raw performance every time.

Limitation: My WebSocket server runs on the same process as the API server. At scale, you'd want a dedicated WebSocket server behind a load balancer with sticky sessions, and you'd need Socket.IO's Redis adapter for cross-instance message broadcasting. I haven't set that up because single-process works fine for the current load, but it's a scaling bottleneck I'm aware of.


WHAT ARE THE 23 STEP TYPES?

They're organized into 6 categories. Navigation: navigate. Interaction: click, fill, scroll, hover, press_key, drag_drop, select_dropdown, right_click, double_click. Data: extract, screenshot, set_variable, extract_to_variable, download_file. Control: wait. Logic: conditional, loop. Advanced: execute_js, set_cookie, get_cookie, set_localstorage, get_localstorage. Each step type has its own execution method in the AutomationEngine class.

The conditional step supports 5 condition types: element_exists, element_visible, text_contains, value_equals (with operators like equals, not_equals, contains, greater_than, less_than), and custom_js. The loop step handles both element iteration (loop over DOM elements matching a selector) and count-based loops, with a max iterations cap of 100 for safety.

Why 23 and not more? I started with the minimum viable set (navigate, click, fill, extract, wait) and added step types based on what I actually needed during testing. Every step type is a maintenance burden since it needs UI config, backend execution logic, variable substitution support, and error handling. Some workflow platforms have 100+ node types, but most users use maybe 10. I'd rather have 23 well-tested types than 50 half-baked ones.

What's missing: file upload simulation (choosing a file in an OS dialog), iframe handling (switching contexts), multi-tab orchestration (opening links in new tabs and switching between them), and network interception (blocking/modifying requests). These are all Playwright-supported features I haven't exposed as step types yet. Network interception in particular would be powerful for blocking analytics scripts or capturing API responses during automation.


HOW DOES VARIABLE SUBSTITUTION WORK?

There's a variableSubstitution.ts utility that uses regex to find ${varName} patterns in strings. It supports nested property access via dot notation through a getNestedValue helper that walks the object path. The substituteObjectVariables function recursively processes entire step config objects, handling strings, arrays, and nested objects. During execution, the AutomationEngine maintains a variables dictionary on the execution context. Steps like set_variable and extract_to_variable write to it, and subsequent steps can reference those values. Loop iterations also inject special variables: loopIndex, loopTotal, loopIteration, loopElementText, and loopElementHTML, which get cleaned up after the loop finishes.

Limitation: The regex-based substitution is fragile. It doesn't handle escaped dollar signs, nested template expressions, or type coercion. If a variable resolves to an object and it's embedded in a string, you get "[object Object]." A proper implementation would use a template engine or at least an AST-based parser. For a v2, I'd look at something like Handlebars or even a simple recursive descent parser that understands types. The current approach works for the common cases (string interpolation, dot-path access) but breaks down for edge cases.


HOW DOES SCHEDULING WORK?

The SchedulerService polls Supabase every 60 seconds for scheduled_jobs where is_active is true and next_run_at is in the past. When it finds due jobs, it batch-fetches all related workflows in one query to avoid N+1, creates an execution, updates next_run_at BEFORE queuing the job (to prevent duplicate execution if the polling interval overlaps), then enqueues it to BullMQ.

There's a failure tracking system: if a scheduled job fails 5 consecutive times, the service auto-pauses it by setting is_active to false. It checks execution results 2 minutes after triggering via setTimeout. The cron parsing uses the cron-parser library, and the frontend offers presets (daily, weekly, monthly) plus custom cron expressions with next-run-time preview.

Why polling instead of cron-based scheduling? BullMQ actually has built-in repeatable jobs that handle cron natively. I could have used job.add('name', data, { repeat: { cron: '0 9 * * *' } }) and let BullMQ manage the schedule entirely. I built my own scheduler because I wanted schedule metadata in the database (for the UI to show next run times, edit schedules, show failure counts) and because I wanted the auto-pause-on-failure feature. BullMQ's repeatable jobs don't have that, since they just keep firing regardless of outcomes.

Trade-off: My polling approach has a 60-second granularity. If a job is due at 09:00:01, it won't run until 09:01:00 at the latest. For cron jobs this is usually fine (nobody needs their daily report at exactly 9:00:00.000), but it's worth knowing. A hybrid approach would use BullMQ's delayed jobs with precise timing while keeping the metadata in Supabase, but that's more complexity for marginal benefit.

The duplicate execution prevention (update next_run_at before queuing) is one of the more important correctness details in the codebase. Without it, if the scheduler polls, finds a due job, queues it, and then polls again before the job has finished, it would queue a duplicate. This is a classic distributed systems issue, essentially the "at-least-once vs exactly-once" delivery problem. My approach gives me "at-most-once" for scheduling, which is the right trade-off since a missed execution is better than a duplicate one that might submit a form twice.


HOW DOES DATA ARCHIVAL WORK?

The ArchivalService runs daily at 2 AM (scheduled via setTimeout/setInterval in the server startup). It finds executions older than the user's retention period (configurable: 7, 30, or 90 days), serializes them to JSON, uploads to Cloudflare R2 with a key pattern of executions/{userId}/{executionId}.json, then clears the logs and extracted_data from the Supabase record and marks it as archived. If R2 upload succeeds but the Supabase update fails, it rolls back by deleting from R2. Archived executions can be restored by downloading from R2 and repopulating the Supabase fields. After archival, it invalidates all analytics caches for that user. Batch processing is capped at 50 executions per run with 100ms delays between each to avoid hammering the APIs.

Why Cloudflare R2 over AWS S3 or Google Cloud Storage? Zero egress fees. That's it, that's the reason. S3 charges $0.09/GB for data transfer out, and while that sounds small, it adds up fast if users are restoring archived executions regularly. R2's storage cost ($0.015/GB/month) is slightly higher than S3 Standard ($0.023/GB, though S3 has tiered discounts), but the zero egress makes R2 cheaper for any workload where you read data back. For archival where data is written once and occasionally restored, R2 is the obvious choice.

S3 would be better if I needed lifecycle policies (automatic transition from Standard to Glacier after 90 days), cross-region replication, or deep AWS ecosystem integration (Lambda triggers, Athena queries on archived data). GCS would be better for ML workloads that need tight BigQuery integration. But for simple "store JSON blobs and occasionally retrieve them," R2 wins on cost.

Limitation: The setTimeout/setInterval-based scheduling for the archival service is fragile. If the server restarts at 1:59 AM, the next archival run won't happen until 2 AM the next day plus however long the server took to restart. A proper solution would use a persistent scheduler (BullMQ repeatable job, or even a simple cron entry) that survives restarts. I'm also not handling the case where archival takes longer than 24 hours to complete, since there's no lock to prevent overlapping runs. At scale, I'd use a distributed lock (Redis SETNX) to ensure only one archival process runs at a time.


WHAT'S THE DATABASE SCHEMA LIKE?

Five tables: workflows, executions, scheduled_jobs, usage_quotas, and execution_logs. All use UUID primary keys. Row Level Security is enabled on every table with policies scoped to auth.uid() = user_id.

I added performance-focused indexes: partial indexes on executions (WHERE archived = FALSE) for active execution queries, composite indexes on (user_id, started_at DESC) for user timeline queries, and trigram indexes (pg_trgm extension) on workflow name and description for fuzzy text search. I also created two PostgreSQL functions (get_execution_trends, get_workflow_usage) that do the aggregation in SQL instead of JavaScript, with a fallback to client-side processing if the RPC functions aren't available. Storage buckets for workflow-attachments (10MB limit) and execution-screenshots (5MB, PNG/JPEG/WebP only) have their own RLS policies using storage.foldername to scope to user directories.

Why push aggregation to SQL? The naive approach is: fetch all executions for a user, loop through them in JavaScript to count successes/failures per day, build a trend object. That works until someone has 10,000 executions and you're pulling megabytes of data over the network just to count them. The PostgreSQL functions do the GROUP BY and date_trunc in the database, returning a small result set. The fallback exists because Supabase's RPC function deployment can be flaky, and I didn't want the analytics dashboard to break if the functions weren't there.

Scalability: The partial index on archived = FALSE is the most important optimization. As executions accumulate and get archived, the active dataset stays small. Without it, every query that fetches recent executions would scan the entire table. At 100K+ executions, that's the difference between 5ms and 500ms query times. The trigram indexes for fuzzy search are probably overkill at my current scale but they cost almost nothing to maintain and they prevent a full table scan on LIKE '%search%' queries.


HOW DOES THE ANALYTICS DASHBOARD WORK?

The AnalyticsService provides execution trends (daily breakdown over N days), top workflows by execution count, slowest and most-failed workflows, error analysis (groups error messages, counts occurrences, tracks affected workflows), and resource usage monitoring. Everything is cached in Redis with TTLs ranging from 10 to 30 minutes depending on how often the data changes.

The resource monitoring tracks usage against free tier limits: Render compute hours (750/month), Upstash Redis commands (10,000/day), Supabase bandwidth (2GB), and Cloudflare R2 storage (10GB). The Render hours are estimated from process.uptime(), Redis commands are tracked via an internal counter on the QueueService, and Supabase bandwidth is estimated from execution and log counts multiplied by average record sizes.

Limitation: The resource estimates are approximations, not real measurements. The Supabase bandwidth calculation assumes average record sizes that I eyeballed from a few sample queries. The Redis command count doesn't account for commands from other processes or services. The Render compute hours from process.uptime() don't account for cold starts and restarts. For a real product, I'd use each service's API to query actual usage (Supabase has a management API, Upstash exposes command counts via INFO). But for a dashboard demo, the estimates are close enough to be useful.


WHAT ABOUT SECURITY?

Multiple layers. Helmet handles security headers (CSP, X-Frame-Options, etc.). Input sanitization middleware runs on every request using the validator library's escape function, recursively sanitizing strings in body, query params, and URL params to prevent XSS. Rate limiting at 100 requests per 15 minutes via @fastify/rate-limit. Supabase handles auth with JWT verification. RLS on all tables ensures users can only see their own data. Storage bucket policies use folder-based scoping so users can only access files in their own directory. The body size limit is 1MB. CORS is configured to only allow the frontend origin. On the frontend side, DOMPurify is a dependency for any user-generated content rendering.

The rate limiting is basic, a fixed window counter per IP. In a distributed system, you'd want a sliding window or token bucket algorithm backed by Redis for cross-instance consistency. Token bucket is what Stripe uses because it naturally handles bursty traffic while enforcing overall limits. My fixed window has the classic boundary problem: a client can send 100 requests at 14:59 and 100 more at 15:01, getting 200 requests in 2 minutes despite a "100 per 15 minutes" limit. A sliding window log would fix that, but @fastify/rate-limit doesn't support it out of the box. At my current scale of maybe 10 requests per minute total, this is theoretical, but it's the kind of thing that matters in production.

What I'd add with more time: CSRF protection (currently relying on CORS and SameSite cookies, which is usually sufficient for API-only backends but not bulletproof), request signing for webhook endpoints, and audit logging for sensitive operations like workflow deletion and schedule modification.


WHAT'S THE FRONTEND ARCHITECTURE?

Next.js 15 with App Router, React 19, TypeScript, Tailwind CSS 4. State management is Zustand (no Redux, no Context API for global state). The workflow builder uses @xyflow/react (React Flow) with custom node types that map 1:1 to the backend step types.

There's a FlowCanvas component for the drag-and-drop editor, a NodePalette for the step type picker, a ConfigPanel for editing step properties, a ValidationPanel for pre-execution checks, and a WorkflowToolbar for save/run/schedule actions. The API client in lib/api.ts centralizes all backend communication. Real-time updates go through a Socket.IO client with a custom useExecutionSubscription hook. Auth uses Supabase client-side with a ProtectedRoute wrapper component.

Why Zustand over Redux or Context? Redux is overkill for this. I have maybe 5 pieces of global state: current user, active workflow, execution status, socket connection, and UI preferences. Redux's action/reducer ceremony would triple my boilerplate for no benefit. Context API works but causes unnecessary re-renders since any context update re-renders all consumers. Zustand gives me subscribe-based updates where components only re-render when the specific slice they use changes, with a simpler API than Redux Toolkit and no provider wrapper needed.

Why React Flow? Building a node-based visual editor from scratch would take weeks. React Flow (@xyflow/react) gives me draggable nodes, edge connections, viewport controls, minimap, and keyboard shortcuts out of the box. The custom node types are just React components, so I have full control over what each node looks like and how its config panel works. The library is well-maintained, TypeScript-first, and handles performance well up to a few hundred nodes.


HOW DOES THE DOWNLOAD FILE STEP WORK?

It listens for Playwright's download event before triggering the download (either by clicking a selector or navigating to a URL). Once the download completes, it reads the file into a buffer via createReadStream, determines the MIME type from the file extension (supports PDF, CSV, JSON, Excel, ZIP, and common image formats), then uploads to Supabase Storage in a user-scoped path. The uploaded file path is returned in the step result. This lets workflows automate things like downloading reports from web apps and storing them centrally.

Limitation: There's no file size limit on downloads beyond Supabase Storage's bucket limits (10MB for workflow-attachments). A malicious or misconfigured workflow could trigger a huge download that eats memory since I'm reading the entire file into a buffer. A streaming upload approach (pipe the download stream directly to Supabase Storage) would be more memory-efficient but Supabase's storage client doesn't support streaming uploads cleanly. I'd need to use the underlying tus protocol directly.


WHAT WOULD I DO DIFFERENTLY WITH MORE TIME?

Testing: Add a proper test framework (Vitest, since it's fast and supports ESM natively) instead of standalone tsx scripts. The current tests work but they're not using a test runner, so there's no parallel execution, no assertion library, no coverage reporting. I'd also add integration tests that spin up a test database and Redis instance via Docker Compose, and contract tests between the frontend API client and backend routes.

Workflow versioning: Users can't roll back to previous workflow definitions. Every save overwrites the current version. I'd add a versions table that stores snapshots on each save, with a diff view in the UI. n8n does this well with their workflow history feature.

Error screenshots: The error screenshot feature captures full-page screenshots on failure but doesn't persist them in a way the UI can display yet. The screenshots get taken and logged but aren't surfaced in the execution detail view.

Worker separation: Move the worker to a dedicated service separate from the API server, so browser automation doesn't compete with API requests for resources. BullMQ already supports this since the queue and worker use separate Redis connections. The architecture is ready for it, I just haven't split the deployment yet.

Browser pooling: Use Playwright's browser pool pattern instead of launching a new browser per execution. Browser launch takes 2-3 seconds. A warm pool of 5 browsers would eliminate that startup cost and reduce memory churn from constant browser creation/destruction.

Workflow marketplace: Let users share workflow templates. Most automation platforms have a template library where you can import common workflows (e.g., "scrape Hacker News front page daily"). This would make the platform more useful out of the box.


HOW WOULD I SCALE THIS?

Right now the AutomationEngine has a maxConcurrent of 2 browsers with a polling wait loop. Here's what I'd change at each scale milestone:

10-50 concurrent users: Separate the worker into its own Render service. BullMQ already supports distributed workers since the queue and worker use separate Redis connections. Add a Redis-backed Socket.IO adapter so WebSocket events broadcast across API instances.

50-200 concurrent users: Switch to a browser-as-a-service provider (Browserless or Steel) instead of managing browser instances directly. I already support this via the BROWSER_WS_URL env var, so it's a config change. Add read replicas for analytics queries so they don't compete with write operations. Upgrade from Upstash free tier to a dedicated Redis instance.

200+ concurrent users: Move to Kubernetes with auto-scaling worker pods. Replace the polling-based scheduler with a proper distributed scheduler (or use Temporal at this point, since the complexity is now justified). Add geographic distribution for the API layer with edge routing. The partial indexes and archival system would keep the database manageable, but I'd probably add a time-series database (TimescaleDB) for analytics data instead of querying the main executions table.

The honest truth is that AutoFlow Pro is architected for the 10-50 user range. The foundations (decoupled queue, remote browser support, archival to object storage, cached analytics) are the right patterns for scaling, but the implementations are simplified for a single-server deployment. Scaling is more about operations than code, and I know what the operational gaps are.


WHAT WERE THE BIGGEST CHALLENGES?

Getting WebSocket to not overwhelm the client during fast workflows. A 10-step workflow can produce 30+ log messages in a few seconds, and without batching the UI was re-rendering on every single message. The 1-second batch interval with throttled message sending solved that. I considered using requestAnimationFrame on the client side instead, but the batching approach reduces network traffic too, not just render pressure.

The scheduler's duplicate execution problem. If a scheduled job was due and the polling interval overlapped with job processing, it would trigger twice. I fixed it by updating next_run_at before queuing the job, not after. This is the classic "check-then-act" race condition and the fix is a standard pattern: do the mutation first, then the side effect. If the side effect (queuing) fails, the worst case is a missed execution, not a duplicate.

The archival rollback logic. If the R2 upload succeeds but the Supabase update fails, you need to clean up R2 or you'll have orphaned data. I added a catch-based rollback that deletes from R2 if the database update fails. Ideally this would use a saga pattern or a two-phase commit, but for two services with one being eventually consistent object storage, the catch-and-cleanup approach is pragmatic enough.

Browser memory management. Playwright's Chromium process can easily eat 200-300MB per instance. On Render's free tier with limited memory, having two browsers open simultaneously plus the Node.js process plus Redis connections pushes close to the limit. I added aggressive page cleanup (close pages after each step if possible) and browser context recycling, but memory pressure is the main reason maxConcurrent is capped at 2.


DEPLOYMENT ARCHITECTURE

All free tier services. Frontend on Vercel, backend API on Render (Singapore region for Asia proximity), Supabase for Postgres and auth, Upstash Redis for BullMQ queue and caching, Cloudflare R2 for archival storage. GitHub Actions runs keep-alive pings every 5 minutes to prevent Render's free tier from sleeping. Docker Compose is available for local development with Postgres and Redis containers, so you don't need cloud dependencies to develop.

Why this stack of free tiers? It's not just about saving money. Each service was chosen because it's the best free option in its category: Vercel for Next.js hosting (they literally built it), Render for long-running Node.js processes (Heroku's free tier died), Supabase for Postgres with auth and RLS built in (vs. managing my own database), Upstash for serverless Redis (vs. running a Redis container on Render and eating into compute), R2 for storage without egress fees.

The keep-alive pings are a hack. Render's free tier sleeps after 15 minutes of inactivity, and cold starts take 30-60 seconds, which kills the user experience. The GitHub Actions cron job pings the health endpoint every 5 minutes to keep it warm. This is technically against the spirit of "free tier" but widely practiced and not explicitly against Render's TOS. If this were a real product, I'd pay for the $7/month Starter tier to avoid this dance.


DEMO WALKTHROUGH (2 MINUTES)

1. Start with the problem: "I built a platform where you can automate browser tasks visually, without writing code."
2. Show the workflow builder: drag a Navigate node, a Fill node, and an Extract node. Connect them. Configure the navigate URL, fill selector and value, extract selector.
3. Hit Run and switch to the execution view. Show the real-time log stream and progress bar updating via WebSocket.
4. Show the analytics dashboard: execution trends chart, success rates, top workflows, error analysis.
5. Show scheduling: set up a daily cron, show next run time preview.
6. Talk about the architecture: "Fastify API, BullMQ for reliable job processing, Playwright for browser automation with anti-detection, Socket.IO for real-time updates, all on free tier infrastructure."
7. If asked about trade-offs: "The biggest one is sequential execution. Real workflow engines support parallel branches and DAG scheduling. I kept it linear to ship faster, but the architecture supports adding it since the queue and worker are already decoupled."

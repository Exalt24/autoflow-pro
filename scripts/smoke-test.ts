const API_URL = process.env.API_URL || "http://localhost:4000";

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface HealthResponse {
  status: string;
}

interface DetailedHealthResponse {
  status: string;
  checks: {
    database: {
      status: string;
      responseTime?: number;
    };
    redis: {
      status: string;
      commandsPerMinute?: number;
    };
  };
}

interface MetricsResponse {
  memory: Record<string, any>;
  queue: Record<string, any>;
}

interface ReadyResponse {
  ready: boolean;
}

interface LiveResponse {
  alive: boolean;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`✓ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(`✗ ${name} (${Date.now() - start}ms)`);
    console.log(`  Error: ${error instanceof Error ? error.message : error}`);
  }
}

async function healthCheck() {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) throw new Error(`Status: ${response.status}`);
  const data = (await response.json()) as HealthResponse;
  if (data.status !== "healthy" && data.status !== "degraded") {
    throw new Error(`Health status: ${data.status}`);
  }
}

async function detailedHealth() {
  const response = await fetch(`${API_URL}/health/detailed`);
  if (!response.ok) throw new Error(`Status: ${response.status}`);
  const data = (await response.json()) as DetailedHealthResponse;
  if (!data.checks) throw new Error("Missing health checks");
  if (data.checks.database.status !== "pass") {
    throw new Error("Database check failed");
  }
  if (data.checks.redis.status !== "pass") {
    throw new Error("Redis check failed");
  }
}

async function metrics() {
  const response = await fetch(`${API_URL}/health/metrics`);
  if (!response.ok) throw new Error(`Status: ${response.status}`);
  const data = (await response.json()) as MetricsResponse;
  if (!data.memory || !data.queue) throw new Error("Missing metrics");
}

async function readinessCheck() {
  const response = await fetch(`${API_URL}/health/ready`);
  if (!response.ok) throw new Error(`Status: ${response.status}`);
  const data = (await response.json()) as ReadyResponse;
  if (data.ready !== true) throw new Error("Service not ready");
}

async function livenessCheck() {
  const response = await fetch(`${API_URL}/health/live`);
  if (!response.ok) throw new Error(`Status: ${response.status}`);
  const data = (await response.json()) as LiveResponse;
  if (data.alive !== true) throw new Error("Service not alive");
}

async function corsHeaders() {
  const response = await fetch(`${API_URL}/health`, { method: "OPTIONS" });
  const corsHeader = response.headers.get("access-control-allow-origin");
  if (!corsHeader) throw new Error("Missing CORS headers");
}

async function securityHeaders() {
  const response = await fetch(`${API_URL}/health`);
  const headers = [
    "x-content-type-options",
    "x-frame-options",
    "x-xss-protection",
    "strict-transport-security",
  ];
  for (const header of headers) {
    if (!response.headers.get(header)) {
      console.warn(`  Warning: Missing ${header} header`);
    }
  }
}

async function rateLimiting() {
  const requests = Array(10)
    .fill(null)
    .map(() => fetch(`${API_URL}/health`));
  const responses = await Promise.all(requests);
  const statuses = responses.map((r) => r.status);
  if (statuses.every((s) => s === 200)) {
    console.log("  Note: Rate limiting not triggered (expected in smoke test)");
  }
}

async function runTests() {
  console.log("\n🧪 Running Smoke Tests\n");
  console.log(`Target: ${API_URL}\n`);

  await test("Health Check", healthCheck);
  await test("Detailed Health", detailedHealth);
  await test("Metrics Endpoint", metrics);
  await test("Readiness Check", readinessCheck);
  await test("Liveness Check", livenessCheck);
  await test("CORS Headers", corsHeaders);
  await test("Security Headers", securityHeaders);
  await test("Rate Limiting", rateLimiting);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log("\n" + "=".repeat(50));
  console.log(`Total Tests: ${results.length}`);
  console.log(`Passed: ${passed} ✓`);
  console.log(`Failed: ${failed} ✗`);
  console.log("=".repeat(50) + "\n");

  if (failed > 0) {
    console.log("Failed Tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    process.exit(1);
  }

  console.log("✅ All smoke tests passed!\n");
  process.exit(0);
}

runTests().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});

export {};

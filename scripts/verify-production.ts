const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
}

interface DetailedHealthResponse {
  status: string;
  checks: {
    database: {
      status: string;
      responseTime: number;
    };
    redis: {
      status: string;
      commandsPerMinute: number;
    };
    queue: {
      status: string;
      active: number;
      waiting: number;
    };
    memory: {
      status: string;
      percentage: number;
    };
  };
}

const checks: Check[] = [];

function addCheck(
  name: string,
  status: "pass" | "fail" | "warn",
  message: string
) {
  checks.push({ name, status, message });
  const icon = status === "pass" ? "✓" : status === "warn" ? "⚠" : "✗";
  const color =
    status === "pass"
      ? "\x1b[32m"
      : status === "warn"
      ? "\x1b[33m"
      : "\x1b[31m";
  console.log(`${color}${icon}\x1b[0m ${name}: ${message}`);
}

async function checkBackendHealth() {
  try {
    const response = await fetch(`${BACKEND_URL}/health/detailed`);
    const data = (await response.json()) as DetailedHealthResponse;

    if (data.status === "healthy") {
      addCheck("Backend Health", "pass", "Service is healthy");
    } else if (data.status === "degraded") {
      addCheck("Backend Health", "warn", "Service is degraded but operational");
    } else {
      addCheck("Backend Health", "fail", `Service is ${data.status}`);
    }

    if (data.checks.database.status === "pass") {
      addCheck(
        "Database Connection",
        "pass",
        `Connected (${data.checks.database.responseTime}ms)`
      );
    } else {
      addCheck("Database Connection", "fail", "Database check failed");
    }

    if (data.checks.redis.status === "pass") {
      addCheck(
        "Redis Connection",
        "pass",
        `Connected (${data.checks.redis.commandsPerMinute} cmd/min)`
      );
    } else {
      addCheck("Redis Connection", "fail", "Redis check failed");
    }

    if (data.checks.queue.status === "pass") {
      addCheck(
        "Queue Status",
        "pass",
        `${data.checks.queue.active} active, ${data.checks.queue.waiting} waiting`
      );
    } else {
      addCheck("Queue Status", "fail", "Queue check failed");
    }

    if (data.checks.memory.percentage < 85) {
      addCheck("Memory Usage", "pass", `${data.checks.memory.percentage}%`);
    } else if (data.checks.memory.percentage < 95) {
      addCheck(
        "Memory Usage",
        "warn",
        `${data.checks.memory.percentage}% (high)`
      );
    } else {
      addCheck(
        "Memory Usage",
        "fail",
        `${data.checks.memory.percentage}% (critical)`
      );
    }
  } catch (error) {
    addCheck(
      "Backend Health",
      "fail",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function checkFrontend() {
  try {
    const response = await fetch(FRONTEND_URL);
    if (response.ok) {
      addCheck("Frontend Accessibility", "pass", "Frontend is accessible");
    } else {
      addCheck("Frontend Accessibility", "fail", `Status: ${response.status}`);
    }
  } catch (error) {
    addCheck(
      "Frontend Accessibility",
      "fail",
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function checkEnvironment() {
  const requiredVars = ["FRONTEND_URL", "BACKEND_URL"];

  requiredVars.forEach((varName) => {
    if (process.env[varName]) {
      addCheck(`Environment: ${varName}`, "pass", "Set");
    } else {
      addCheck(`Environment: ${varName}`, "warn", "Not set (using default)");
    }
  });
}

async function checkSSL() {
  if (BACKEND_URL.startsWith("https://")) {
    addCheck("Backend SSL", "pass", "HTTPS enabled");
  } else if (BACKEND_URL.startsWith("http://localhost")) {
    addCheck("Backend SSL", "warn", "Development environment");
  } else {
    addCheck("Backend SSL", "fail", "HTTPS not enabled in production");
  }

  if (FRONTEND_URL.startsWith("https://")) {
    addCheck("Frontend SSL", "pass", "HTTPS enabled");
  } else if (FRONTEND_URL.startsWith("http://localhost")) {
    addCheck("Frontend SSL", "warn", "Development environment");
  } else {
    addCheck("Frontend SSL", "fail", "HTTPS not enabled in production");
  }
}

async function checkResponseTimes() {
  const endpoints = [
    { name: "Health", url: `${BACKEND_URL}/health` },
    { name: "Metrics", url: `${BACKEND_URL}/health/metrics` },
  ];

  for (const endpoint of endpoints) {
    try {
      const start = Date.now();
      const response = await fetch(endpoint.url);
      const duration = Date.now() - start;

      if (response.ok) {
        if (duration < 500) {
          addCheck(`Response Time: ${endpoint.name}`, "pass", `${duration}ms`);
        } else if (duration < 1000) {
          addCheck(
            `Response Time: ${endpoint.name}`,
            "warn",
            `${duration}ms (slow)`
          );
        } else {
          addCheck(
            `Response Time: ${endpoint.name}`,
            "fail",
            `${duration}ms (too slow)`
          );
        }
      }
    } catch (error) {
      addCheck(
        `Response Time: ${endpoint.name}`,
        "fail",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

async function runVerification() {
  console.log("\n🔍 Production Verification\n");
  console.log(`Frontend: ${FRONTEND_URL}`);
  console.log(`Backend: ${BACKEND_URL}\n`);

  await checkEnvironment();
  await checkSSL();
  await checkBackendHealth();
  await checkFrontend();
  await checkResponseTimes();

  const passed = checks.filter((c) => c.status === "pass").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const failed = checks.filter((c) => c.status === "fail").length;

  console.log("\n" + "=".repeat(50));
  console.log(`Total Checks: ${checks.length}`);
  console.log(`Passed: ${passed} ✓`);
  console.log(`Warnings: ${warned} ⚠`);
  console.log(`Failed: ${failed} ✗`);
  console.log("=".repeat(50) + "\n");

  if (failed > 0) {
    console.log("❌ Production verification failed\n");
    process.exitCode = 1;
    return;
  }

  if (warned > 0) {
    console.log("⚠️  Production verification passed with warnings\n");
  } else {
    console.log("✅ Production verification passed!\n");
  }
}

runVerification().catch((error) => {
  console.error("Verification failed:", error);
  process.exitCode = 1;
});

export {};

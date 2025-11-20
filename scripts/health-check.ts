const API_URL = process.env.API_URL || "http://localhost:4000";

interface HealthResponse {
  status: string;
  uptime: number;
  environment: string;
  timestamp: string;
}

async function checkHealth() {
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = (await response.json()) as HealthResponse;

    console.log("\n🏥 Health Check Result\n");
    console.log(`Status: ${data.status}`);
    console.log(`Uptime: ${data.uptime}`);
    console.log(`Environment: ${data.environment}`);
    console.log(`Timestamp: ${data.timestamp}\n`);

    if (data.status === "healthy") {
      console.log("✅ Service is healthy\n");
      return 0;
    } else if (data.status === "degraded") {
      console.log("⚠️  Service is degraded but operational\n");
      return 0;
    } else {
      console.log("❌ Service is unhealthy\n");
      return 1;
    }
  } catch (error) {
    console.error("\n❌ Health check failed:");
    console.error(error instanceof Error ? error.message : error);
    console.error("\n");
    return 1;
  }
}

checkHealth().then((exitCode) => {
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
});

export {};

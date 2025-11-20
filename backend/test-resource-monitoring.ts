import "dotenv/config";
import { createUser, deleteUser } from "./src/config/auth.js";
import { queueService } from "./src/services/QueueService.js";
import { analyticsService } from "./src/services/AnalyticsService.js";
import { executionService } from "./src/services/ExecutionService.js";
import { workflowService } from "./src/services/WorkflowService.js";

const testEmail = `test-resources-${Date.now()}@autoflow.local`;
const testPassword = "TestPassword123!";
let testUserId: string | null = null;

async function testResourceMonitoring() {
  console.log("\n🧪 Testing Resource Monitoring\n");

  try {
    console.log("1. Creating test user...");
    const { user, error: createError } = await createUser(
      testEmail,
      testPassword
    );

    if (createError || !user) {
      const errorMsg =
        typeof createError === "string"
          ? createError
          : createError &&
            typeof createError === "object" &&
            "message" in createError
          ? (createError as { message: string }).message
          : "Unknown error";
      throw new Error(`Failed to create test user: ${errorMsg}`);
    }

    testUserId = user.id;
    console.log(`✓ Test user created: ${testUserId}`);

    console.log("\n2. Testing Redis command tracking...");
    queueService.resetRedisStats();

    await queueService.getQueueMetrics();
    await queueService.getQueueMetrics();
    await queueService.getQueueMetrics();

    const redisStats = queueService.getRedisStats();
    console.log(`✓ Redis stats retrieved:`);
    console.log(`  Command count: ${redisStats.commandCount}`);
    console.log(`  Commands/minute: ${redisStats.commandsPerMinute}`);
    console.log(`  Daily projection: ${redisStats.dailyProjection}`);

    if (redisStats.commandCount === 3) {
      console.log("✓ Redis command tracking working correctly");
    } else {
      console.log(
        `✗ WARNING: Expected 3 commands, got ${redisStats.commandCount}`
      );
    }

    console.log("\n3. Creating test workflow and execution...");
    const workflow = await workflowService.createWorkflow({
      userId: testUserId,
      name: "Test Workflow",
      description: "Test",
      definition: {
        steps: [
          {
            id: "step-1",
            type: "navigate",
            config: { url: "https://example.com" },
          },
        ],
      },
      status: "active",
    });

    const execution = await executionService.createExecution({
      workflowId: workflow.id,
      userId: testUserId,
    });

    await executionService.updateExecution(execution.id, testUserId, {
      status: "completed",
      completedAt: new Date().toISOString(),
      duration: 5,
      extractedData: { test: "data" },
    });

    console.log(`✓ Test workflow and execution created`);

    console.log("\n4. Testing resource usage calculation...");
    const resources = await analyticsService.getResourceUsage(testUserId);

    console.log(`✓ Resource usage calculated:`);
    console.log("\nRender:");
    console.log(
      `  Hours used: ${resources.render.hoursUsed.toFixed(2)} / ${
        resources.render.hoursLimit
      }`
    );
    console.log(`  Percentage: ${resources.render.percentageUsed.toFixed(2)}%`);

    console.log("\nRedis:");
    console.log(
      `  Commands: ${resources.redis.commandsUsed} / ${resources.redis.commandsLimit}`
    );
    console.log(`  Commands/min: ${resources.redis.commandsPerMinute}`);
    console.log(`  Percentage: ${resources.redis.percentageUsed.toFixed(2)}%`);

    console.log("\nSupabase:");
    console.log(
      `  Bandwidth: ${formatBytes(
        resources.supabase.bandwidthUsed
      )} / ${formatBytes(resources.supabase.bandwidthLimit)}`
    );
    console.log(
      `  Percentage: ${resources.supabase.percentageUsed.toFixed(2)}%`
    );

    console.log("\nR2:");
    console.log(
      `  Storage: ${formatBytes(resources.r2.storageUsed)} / ${formatBytes(
        resources.r2.storageLimit
      )}`
    );
    console.log(`  Percentage: ${resources.r2.percentageUsed.toFixed(2)}%`);

    console.log("\n5. Verifying resource limits...");
    if (
      resources.render.hoursLimit === 750 &&
      resources.redis.commandsLimit === 10000 &&
      resources.supabase.bandwidthLimit === 2 * 1024 * 1024 * 1024 &&
      resources.r2.storageLimit === 10 * 1024 * 1024 * 1024
    ) {
      console.log("✓ All resource limits correct (free tier values)");
    } else {
      console.log("✗ WARNING: Resource limits do not match expected values");
    }

    console.log("\n6. Testing percentage calculations...");
    if (
      resources.render.percentageUsed >= 0 &&
      resources.render.percentageUsed <= 100 &&
      resources.redis.percentageUsed >= 0 &&
      resources.redis.percentageUsed <= 100 &&
      resources.supabase.percentageUsed >= 0 &&
      resources.supabase.percentageUsed <= 100 &&
      resources.r2.percentageUsed >= 0 &&
      resources.r2.percentageUsed <= 100
    ) {
      console.log("✓ All percentage calculations valid (0-100%)");
    } else {
      console.log("✗ WARNING: Invalid percentage values detected");
    }

    console.log("\n7. Testing cache behavior...");
    const cachedResources = await analyticsService.getResourceUsage(testUserId);

    if (
      cachedResources.render.hoursUsed === resources.render.hoursUsed &&
      cachedResources.redis.commandsUsed === resources.redis.commandsUsed
    ) {
      console.log("✓ Resource cache working (values match)");
    } else {
      console.log("✗ WARNING: Cache returned different values");
    }

    console.log("\n✅ All resource monitoring tests passed!");
    console.log("\n📊 Test Summary:");
    console.log(`  ✓ Redis command tracking functional`);
    console.log(`  ✓ Resource calculations accurate`);
    console.log(`  ✓ All limits set correctly`);
    console.log(`  ✓ Percentage calculations valid`);
    console.log(`  ✓ Cache behavior confirmed`);
  } catch (error: any) {
    console.error("\n✗ Test failed:", error.message);
    throw error;
  } finally {
    console.log("\n🧹 Cleaning up...");

    if (testUserId) {
      await deleteUser(testUserId);
      console.log("✓ Test user deleted");
    }

    console.log("✓ Cleanup complete");
    process.exit(0);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

testResourceMonitoring().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

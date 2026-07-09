import "dotenv/config";
import {
  testRedisConnection,
  closeRedisConnection,
} from "../src/config/redis.js";
import { queueService } from "../src/services/QueueService.js";

async function testQueueService() {
  console.log("\n🧪 Testing Queue Service...\n");

  try {
    console.log("1️⃣ Testing Redis connection...");
    const redisConnected = await testRedisConnection();
    if (!redisConnected) {
      throw new Error("Redis connection failed");
    }

    console.log("\n2️⃣ Testing queue metrics...");
    const metrics = await queueService.getQueueMetrics();
    console.log("Queue metrics:", metrics);

    console.log("\n3️⃣ Adding test job to queue...");
    const testJob = await queueService.addJob({
      workflowId: "test-workflow-123",
      executionId: "test-execution-456",
      userId: "test-user-789",
      definition: { steps: [] },
    });
    console.log(`✓ Test job added with ID: ${testJob.id}`);

    console.log("\n4️⃣ Getting job status...");
    const jobStatus = await queueService.getJobStatus(testJob.id!);
    console.log("Job status:", jobStatus);

    console.log("\n5️⃣ Removing test job...");
    await queueService.removeJob(testJob.id!);
    console.log("✓ Test job removed");

    console.log("\n6️⃣ Final queue metrics...");
    const finalMetrics = await queueService.getQueueMetrics();
    console.log("Final metrics:", finalMetrics);

    console.log("\n✅ All queue tests passed!");
  } catch (error) {
    console.error("\n❌ Queue test failed:", error);
    process.exit(1);
  } finally {
    console.log("\n🧹 Cleaning up...");
    await queueService.close();
    await closeRedisConnection();
    console.log("✓ Cleanup complete");
    process.exit(0);
  }
}

testQueueService();

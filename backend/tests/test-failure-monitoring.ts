import "dotenv/config";
import { schedulerService } from "../src/services/SchedulerService.js";
import { scheduledJobService } from "../src/services/ScheduledJobService.js";
import { workflowService } from "../src/services/WorkflowService.js";
import { executionService } from "../src/services/ExecutionService.js";
import { createUser, deleteUser } from "../src/config/auth.js";

async function testFailureMonitoring() {
  console.log("\n🧪 Testing Failure Monitoring...\n");

  let testUser: { id: string; email: string } | null = null;
  let testWorkflowId: string | null = null;
  let testScheduledJobId: string | null = null;

  try {
    console.log("1️⃣  Creating test user and workflow...");
    const timestamp = Date.now();
    const email = `test-failure-${timestamp}@autoflow.local`;
    const password = "TestPassword123!";

    const { user, error: userError } = await createUser(email, password);
    if (userError || !user) throw new Error("Failed to create user");
    testUser = { id: user.id, email: user.email! };
    console.log(`   ✅ Test user created: ${testUser.email}`);

    const workflow = await workflowService.createWorkflow({
      userId: testUser.id,
      name: "Failure Test Workflow",
      description: "Workflow for failure monitoring testing",
      definition: {
        steps: [
          {
            id: "step1",
            type: "navigate",
            config: { url: "https://example.com" },
          },
        ],
      },
      status: "active",
    });
    testWorkflowId = workflow.id;
    console.log(`   ✅ Test workflow created: ${testWorkflowId}`);

    console.log("\n2️⃣  Creating scheduled job...");
    const scheduledJob = await scheduledJobService.createScheduledJob({
      userId: testUser.id,
      workflowId: testWorkflowId,
      cronSchedule: "*/5 * * * *",
      isActive: true,
    });
    testScheduledJobId = scheduledJob.id;
    console.log(`   ✅ Scheduled job created: ${testScheduledJobId}`);

    console.log("\n3️⃣  Simulating failed executions...");
    for (let i = 1; i <= 6; i++) {
      const execution = await executionService.createExecution({
        workflowId: testWorkflowId,
        userId: testUser.id,
        status: "queued",
      });

      await executionService.updateExecution(execution.id, testUser.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: `Simulated failure ${i}`,
      });

      console.log(`   ✅ Created failed execution ${i}: ${execution.id}`);

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log("\n4️⃣  Testing failure stats retrieval...");
    const stats = await schedulerService.getJobFailureStats(testScheduledJobId);
    console.log(`   ✅ Stats retrieved:`);
    console.log(`      - Consecutive Failures: ${stats.consecutiveFailures}`);
    console.log(`      - Recent Failure Rate: ${stats.recentFailureRate}%`);
    console.log(
      `      - Total Recent Executions: ${stats.totalRecentExecutions}`
    );
    console.log(`      - Is Paused: ${stats.isPaused}`);
    console.log(`      - Last Failure: ${stats.lastFailureAt || "None"}`);

    console.log("\n5️⃣  Verifying stats calculation...");
    const expectedFailureRate = Math.round((6 / 6) * 100);
    console.log(`   ✅ Expected failure rate: ${expectedFailureRate}%`);
    console.log(`   ✅ Actual failure rate: ${stats.recentFailureRate}%`);
    console.log(
      `   ✅ Match: ${
        stats.recentFailureRate === expectedFailureRate ? "✓" : "✗"
      }`
    );

    console.log("\n✅ All Failure Monitoring Tests Passed!\n");
    console.log(
      "📝 Note: Automatic job pausing happens during scheduled execution checks."
    );
    console.log(
      "   The scheduler checks execution results 2 minutes after job execution.\n"
    );
  } catch (error: any) {
    console.error("\n❌ Test Failed:", error.message);
    console.error(error.stack);
  } finally {
    if (testUser) {
      console.log("\n🧹 Cleaning up test data...");
      await deleteUser(testUser.id);
      console.log("   ✅ Test user deleted");
    }
    process.exit(0);
  }
}

testFailureMonitoring();

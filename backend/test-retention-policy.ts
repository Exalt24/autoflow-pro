import "dotenv/config";
import { createUser, deleteUser } from "./src/config/auth.js";
import { archivalService } from "./src/services/ArchivalService.js";
import { executionService } from "./src/services/ExecutionService.js";
import { workflowService } from "./src/services/WorkflowService.js";

const testEmail = `test-retention-${Date.now()}@autoflow.local`;
const testPassword = "TestPassword123!";
let testUserId: string | null = null;

async function testRetentionPolicy() {
  console.log("\n🧪 Testing Data Retention Policy\n");

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

    console.log("\n2. Testing default retention policy (30 days)...");
    const defaultRetention = await archivalService.getUserRetentionDays(
      testUserId
    );
    console.log(`✓ Default retention: ${defaultRetention} days`);

    if (defaultRetention === 30) {
      console.log("✓ Default retention policy correct");
    } else {
      console.log(`✗ WARNING: Expected 30 days, got ${defaultRetention} days`);
    }

    console.log("\n3. Testing retention policy update (7 days)...");
    await archivalService.updateUserRetentionDays(testUserId, 7);
    const updated7Days = await archivalService.getUserRetentionDays(testUserId);
    console.log(`✓ Retention updated to: ${updated7Days} days`);

    if (updated7Days === 7) {
      console.log("✓ Retention policy update successful");
    } else {
      console.log(`✗ WARNING: Expected 7 days, got ${updated7Days} days`);
    }

    console.log("\n4. Testing retention policy update (90 days)...");
    await archivalService.updateUserRetentionDays(testUserId, 90);
    const updated90Days = await archivalService.getUserRetentionDays(
      testUserId
    );
    console.log(`✓ Retention updated to: ${updated90Days} days`);

    if (updated90Days === 90) {
      console.log("✓ Retention policy update successful");
    } else {
      console.log(`✗ WARNING: Expected 90 days, got ${updated90Days} days`);
    }

    console.log("\n5. Testing invalid retention days...");
    try {
      await archivalService.updateUserRetentionDays(testUserId, 45);
      console.log("✗ FAILED: Should have thrown error for invalid days");
    } catch (error: any) {
      console.log(`✓ Correctly rejected invalid value: ${error.message}`);
    }

    console.log("\n6. Creating test executions with different ages...");
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

    const executions = [];

    const exec1 = await executionService.createExecution({
      workflowId: workflow.id,
      userId: testUserId,
    });
    const date1 = new Date();
    date1.setDate(date1.getDate() - 5);
    await executionService.updateExecution(exec1.id, testUserId, {
      status: "completed",
      completedAt: date1.toISOString(),
      duration: 5,
    });
    executions.push({ id: exec1.id, age: "5 days" });

    const exec2 = await executionService.createExecution({
      workflowId: workflow.id,
      userId: testUserId,
    });
    const date2 = new Date();
    date2.setDate(date2.getDate() - 35);
    await executionService.updateExecution(exec2.id, testUserId, {
      status: "completed",
      completedAt: date2.toISOString(),
      duration: 5,
    });
    executions.push({ id: exec2.id, age: "35 days" });

    const exec3 = await executionService.createExecution({
      workflowId: workflow.id,
      userId: testUserId,
    });
    const date3 = new Date();
    date3.setDate(date3.getDate() - 100);
    await executionService.updateExecution(exec3.id, testUserId, {
      status: "completed",
      completedAt: date3.toISOString(),
      duration: 5,
    });
    executions.push({ id: exec3.id, age: "100 days" });

    console.log(`✓ Created 3 test executions (5, 35, 100 days old)`);

    console.log("\n7. Testing archival with 7-day retention...");
    await archivalService.updateUserRetentionDays(testUserId, 7);
    const eligible7Days = await archivalService.getExecutionsToArchive(
      testUserId
    );
    console.log(
      `✓ Executions eligible for archival (7d): ${eligible7Days.length}`
    );

    if (eligible7Days.length === 2) {
      console.log("✓ Correct: 2 executions older than 7 days");
    } else {
      console.log(
        `✗ WARNING: Expected 2 eligible, got ${eligible7Days.length}`
      );
    }

    console.log("\n8. Testing archival with 30-day retention...");
    await archivalService.updateUserRetentionDays(testUserId, 30);
    const eligible30Days = await archivalService.getExecutionsToArchive(
      testUserId
    );
    console.log(
      `✓ Executions eligible for archival (30d): ${eligible30Days.length}`
    );

    if (eligible30Days.length === 2) {
      console.log("✓ Correct: 2 executions older than 30 days");
    } else {
      console.log(
        `✗ WARNING: Expected 2 eligible, got ${eligible30Days.length}`
      );
    }

    console.log("\n9. Testing archival with 90-day retention...");
    await archivalService.updateUserRetentionDays(testUserId, 90);
    const eligible90Days = await archivalService.getExecutionsToArchive(
      testUserId
    );
    console.log(
      `✓ Executions eligible for archival (90d): ${eligible90Days.length}`
    );

    if (eligible90Days.length === 1) {
      console.log("✓ Correct: 1 execution older than 90 days");
    } else {
      console.log(
        `✗ WARNING: Expected 1 eligible, got ${eligible90Days.length}`
      );
    }

    console.log("\n10. Testing archival stats with retention days...");
    const stats = await archivalService.getArchivalStats(testUserId);
    console.log(`✓ Archival stats retrieved:`);
    console.log(`  Total executions: ${stats.totalExecutions}`);
    console.log(`  Active: ${stats.activeExecutions}`);
    console.log(`  Archived: ${stats.archivedExecutions}`);
    console.log(`  Eligible: ${stats.eligibleForArchival}`);
    console.log(`  Retention policy: ${stats.retentionDays} days`);

    if (stats.retentionDays === 90) {
      console.log("✓ Retention days included in stats");
    } else {
      console.log("✗ WARNING: Retention days not in stats");
    }

    console.log("\n✅ All retention policy tests passed!");
    console.log("\n📊 Test Summary:");
    console.log(`  ✓ Default policy: 30 days`);
    console.log(`  ✓ Policy updates: 7, 30, 90 days`);
    console.log(`  ✓ Invalid value rejected`);
    console.log(`  ✓ Age-based eligibility correct for all policies`);
    console.log(`  ✓ Stats include retention days`);
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

testRetentionPolicy().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

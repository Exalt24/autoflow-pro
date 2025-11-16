import "dotenv/config";
import { createUser, deleteUser } from "./src/config/auth.js";
import { analyticsService } from "./src/services/AnalyticsService.js";
import { workflowService } from "./src/services/WorkflowService.js";
import { executionService } from "./src/services/ExecutionService.js";

async function testErrorAnalysis() {
  console.log("🧪 Testing Error Analysis Feature\n");

  let testUserId: string | null = null;
  let workflowId: string | null = null;

  try {
    const testEmail = `test-errors-${Date.now()}@autoflow.local`;
    const testPassword = "TestPassword123!";

    console.log("1️⃣  Creating test user...");
    const { user, error: userError } = await createUser(
      testEmail,
      testPassword
    );
    if (userError || !user) {
      throw new Error(`Failed to create user: ${userError}`);
    }
    testUserId = user.id;
    console.log("✅ User created:", testUserId.substring(0, 8));

    console.log("\n2️⃣  Creating test workflow...");
    const workflow = await workflowService.createWorkflow({
      userId: testUserId,
      name: "Error Test Workflow",
      description: "Testing error analysis",
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
    workflowId = workflow.id;
    console.log("✅ Workflow created");

    console.log("\n3️⃣  Creating 7 failed executions with different errors...");
    const errorMessages = [
      "Selector not found: .missing-element",
      "Selector not found: .missing-element",
      "Selector not found: .missing-element",
      "Navigation timeout exceeded",
      "Navigation timeout exceeded",
      "Element not visible: #hidden-btn",
      "Network request failed",
    ];

    for (let i = 0; i < errorMessages.length; i++) {
      const execution = await executionService.createExecution({
        workflowId: workflowId,
        userId: testUserId,
      });

      await executionService.updateExecution(execution.id, testUserId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        duration: 1000 + i * 100,
        errorMessage: errorMessages[i],
      });

      console.log(`   Created execution ${i + 1}/7: ${errorMessages[i]}`);
    }

    console.log("\n4️⃣  Fetching error analysis...");
    const errors = await analyticsService.getErrorAnalysis(testUserId, 10);
    console.log(`✅ Retrieved ${errors.length} unique error types`);

    console.log("\n5️⃣  Validating error grouping...");
    if (errors.length === 0) {
      throw new Error("Expected errors but got none");
    }

    const topError = errors[0];
    console.log("\n📊 Top Error Details:");
    console.log(`   Message: ${topError.errorMessage}`);
    console.log(`   Occurrences: ${topError.count}`);
    console.log(`   Affected Workflows: ${topError.affectedWorkflows}`);
    console.log(`   Last Seen: ${topError.lastOccurred}`);
    console.log(`   Sample Executions: ${topError.affectedExecutions.length}`);

    if (topError.errorMessage !== "Selector not found: .missing-element") {
      throw new Error(
        `Expected top error to be 'Selector not found', got '${topError.errorMessage}'`
      );
    }
    if (topError.count !== 3) {
      throw new Error(`Expected count of 3, got ${topError.count}`);
    }
    if (topError.affectedWorkflows !== 1) {
      throw new Error(
        `Expected 1 affected workflow, got ${topError.affectedWorkflows}`
      );
    }

    console.log("\n6️⃣  Verifying all 4 unique errors are present...");
    const expectedErrors = [
      { msg: "Selector not found: .missing-element", count: 3 },
      { msg: "Navigation timeout exceeded", count: 2 },
      { msg: "Element not visible: #hidden-btn", count: 1 },
      { msg: "Network request failed", count: 1 },
    ];

    for (const expected of expectedErrors) {
      const found = errors.find((e) => e.errorMessage === expected.msg);
      if (!found) {
        throw new Error(`Missing error: ${expected.msg}`);
      }
      if (found.count !== expected.count) {
        throw new Error(
          `Wrong count for '${expected.msg}': expected ${expected.count}, got ${found.count}`
        );
      }
      console.log(`   ✓ ${expected.msg} (${found.count}x)`);
    }

    console.log("\n7️⃣  Verifying sample executions limit (max 5)...");
    for (const error of errors) {
      if (error.affectedExecutions.length > 5) {
        throw new Error(
          `Sample executions should be limited to 5, got ${error.affectedExecutions.length}`
        );
      }
    }
    console.log("✅ Sample executions correctly limited");

    console.log("\n✅ ALL ERROR ANALYSIS TESTS PASSED!\n");
  } catch (error: any) {
    console.error("\n❌ TEST FAILED:", error.message);
    throw error;
  } finally {
    if (testUserId) {
      console.log("🧹 Cleaning up test data...");
      await deleteUser(testUserId);
      console.log("✅ Cleanup complete\n");
    }
    process.exit(0);
  }
}

testErrorAnalysis();

import "dotenv/config";
import { executionService } from "./src/services/ExecutionService.js";
import { analyticsService } from "./src/services/AnalyticsService.js";
import { workflowService } from "./src/services/WorkflowService.js";
import { createUser, deleteUser } from "./src/config/auth.js";

async function testExecutionAndAnalytics() {
  console.log("\n🧪 Testing Execution & Analytics Services...\n");

  const testEmail = `test-exec-${Date.now()}@autoflow.local`;
  const testPassword = "TestPassword123!";
  let testUserId: string | undefined;
  let workflowId: string;
  let executionId: string;

  try {
    console.log("📝 Setting up test user and workflow...");
    const { user, error: createError } = await createUser(
      testEmail,
      testPassword
    );
    if (createError || !user) {
      throw new Error(`Failed to create test user: ${createError}`);
    }
    testUserId = user.id;
    console.log(`✓ Test user created: ${testUserId}`);

    const workflow = await workflowService.createWorkflow({
      userId: testUserId,
      name: "Test Analytics Workflow",
      definition: {
        steps: [
          {
            id: "step-1",
            type: "navigate",
            config: { url: "https://example.com" },
          },
        ],
      },
    });
    workflowId = workflow.id;
    console.log(`✓ Test workflow created: ${workflowId}`);

    console.log("\n1️⃣ Testing execution creation...");
    const execution = await executionService.createExecution({
      workflowId,
      userId: testUserId,
      status: "queued",
    });
    executionId = execution.id;
    console.log(`✓ Created execution: ${executionId}`);
    console.log(`  Status: ${execution.status}`);

    console.log("\n2️⃣ Testing execution retrieval...");
    const retrieved = await executionService.getExecutionById(
      executionId,
      testUserId
    );
    if (!retrieved) {
      throw new Error("Failed to retrieve execution");
    }
    console.log(`✓ Retrieved execution: ${retrieved.id}`);

    console.log("\n3️⃣ Testing execution status update...");
    await executionService.updateExecutionStatus(
      executionId,
      testUserId,
      "running"
    );
    console.log("✓ Updated status to running");

    console.log("\n4️⃣ Testing log addition...");
    await executionService.addLog(
      executionId,
      testUserId,
      "info",
      "Starting workflow execution",
      "step-1"
    );
    await executionService.addLog(
      executionId,
      testUserId,
      "info",
      "Navigating to URL",
      "step-1"
    );
    await executionService.addLog(
      executionId,
      testUserId,
      "warn",
      "Slow response time",
      "step-1"
    );
    console.log("✓ Added 3 log entries");

    console.log("\n5️⃣ Testing log retrieval...");
    const logs = await executionService.getLogs(executionId, testUserId);
    console.log(`✓ Retrieved ${logs.logs.length} log entries`);
    console.log(`  First log: ${logs.logs[0]?.message}`);

    console.log("\n6️⃣ Testing execution completion...");
    await executionService.updateExecutionStatus(
      executionId,
      testUserId,
      "completed"
    );
    const completed = await executionService.getExecutionById(
      executionId,
      testUserId
    );
    console.log(`✓ Execution completed`);
    console.log(`  Duration: ${completed?.duration}s`);

    console.log("\n7️⃣ Testing execution list with pagination...");
    const execList = await executionService.listExecutions({
      userId: testUserId,
      page: 1,
      limit: 10,
    });
    console.log(`✓ Listed executions: ${execList.executions.length} found`);
    console.log(`  Total: ${execList.total}`);

    console.log("\n8️⃣ Testing execution list with workflow filter...");
    const filteredList = await executionService.listExecutions({
      userId: testUserId,
      workflowId,
      page: 1,
      limit: 10,
    });
    console.log(
      `✓ Filtered executions: ${filteredList.executions.length} found`
    );

    console.log("\n9️⃣ Creating additional test executions...");
    await executionService.createExecution({
      workflowId,
      userId: testUserId,
      status: "completed",
    });
    await executionService.createExecution({
      workflowId,
      userId: testUserId,
      status: "failed",
    });
    console.log("✓ Created 2 additional executions");

    console.log("\n🔟 Testing user statistics...");
    const stats = await analyticsService.getUserStats(testUserId);
    console.log(`✓ Retrieved user stats:`);
    console.log(`  Total Workflows: ${stats.totalWorkflows}`);
    console.log(`  Total Executions: ${stats.totalExecutions}`);
    console.log(`  Success Rate: ${stats.successRate.toFixed(1)}%`);
    console.log(`  Avg Duration: ${stats.averageDuration.toFixed(1)}s`);

    console.log("\n1️⃣1️⃣ Testing execution trends...");
    const trends = await analyticsService.getExecutionTrends(testUserId, 7);
    console.log(`✓ Retrieved ${trends.length} days of trend data`);
    const today = trends[trends.length - 1];
    console.log(
      `  Today: ${today?.total} executions (${today?.successful} successful)`
    );

    console.log("\n1️⃣2️⃣ Testing top workflows...");
    const topWorkflows = await analyticsService.getTopWorkflows(testUserId, 5);
    console.log(`✓ Retrieved top ${topWorkflows.length} workflows`);
    if (topWorkflows[0]) {
      console.log(
        `  Most used: ${topWorkflows[0].workflowName} (${topWorkflows[0].executionCount} executions)`
      );
    }

    console.log("\n1️⃣3️⃣ Testing usage quota...");
    const quota = await analyticsService.getUserQuota(testUserId);
    console.log(`✓ Retrieved usage quota:`);
    console.log(`  Workflows: ${quota.workflowsCount}/${quota.workflowsLimit}`);
    console.log(
      `  Executions: ${quota.executionsCount}/${quota.executionsLimit}`
    );

    console.log("\n1️⃣4️⃣ Testing slowest workflows...");
    const slowest = await analyticsService.getSlowestWorkflows(testUserId, 5);
    console.log(`✓ Retrieved ${slowest.length} slowest workflows`);

    console.log("\n1️⃣5️⃣ Testing failed workflows...");
    const failed = await analyticsService.getFailedWorkflows(testUserId, 5);
    console.log(`✓ Retrieved ${failed.length} workflows with failures`);

    console.log("\n1️⃣6️⃣ Testing old executions query...");
    const oldExecutions = await executionService.getOldExecutions(30);
    console.log(
      `✓ Found ${oldExecutions.length} executions older than 30 days`
    );

    console.log("\n1️⃣7️⃣ Testing execution deletion...");
    await executionService.deleteExecution(executionId, testUserId);
    const deleted = await executionService.getExecutionById(
      executionId,
      testUserId
    );
    if (deleted === null) {
      console.log("✓ Execution deleted successfully");
    } else {
      throw new Error("Execution still exists after deletion");
    }

    console.log("\n✅ All execution & analytics tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
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

testExecutionAndAnalytics();

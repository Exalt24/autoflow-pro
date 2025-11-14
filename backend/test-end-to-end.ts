import "dotenv/config";
import { queueService } from "./src/services/QueueService.js";
import { processWorkflowJob } from "./src/services/WorkerProcessor.js";
import { executionService } from "./src/services/ExecutionService.js";
import { workflowService } from "./src/services/WorkflowService.js";
import { createUser, deleteUser } from "./src/config/auth.js";
import type { WorkflowDefinition } from "./src/types/database.js";

console.log(
  "🧪 Testing End-to-End Workflow - Part 5: Queue Worker Integration\n"
);

let testUserId: string;
let testUserEmail: string;

async function setupTestUser(): Promise<void> {
  testUserEmail = `test-e2e-${Date.now()}@autoflow.local`;
  const { user, error } = await createUser(testUserEmail, "TestPassword123!");

  if (error || !user) {
    throw new Error(`Failed to create test user: ${error || "Unknown error"}`);
  }

  testUserId = user.id;
  console.log(`✓ Test user created: ${testUserEmail}\n`);
}

async function cleanupTestUser(): Promise<void> {
  if (testUserId) {
    await deleteUser(testUserId);
    console.log(`✓ Test user cleaned up\n`);
  }
}

async function testBasicWorkflowExecution() {
  console.log("Test 1: Basic Workflow Execution through Queue");

  const definition: WorkflowDefinition = {
    steps: [
      { id: "nav", type: "navigate", config: { url: "https://example.com" } },
      { id: "title", type: "extract", config: { selector: "h1" } },
    ],
  };

  const workflow = await workflowService.createWorkflow({
    userId: testUserId,
    name: "E2E Test Workflow",
    description: "End-to-end test",
    definition,
    status: "active",
  });

  const execution = await executionService.createExecution({
    workflowId: workflow.id,
    userId: testUserId,
  });

  try {
    const job = await queueService.addJob({
      executionId: execution.id,
      workflowId: workflow.id,
      userId: testUserId,
      definition: definition as unknown,
    });

    await processWorkflowJob(job as any);

    const updatedExecution = await executionService.getExecutionById(
      execution.id,
      testUserId
    );

    if (
      updatedExecution?.status === "completed" &&
      updatedExecution.extracted_data
    ) {
      console.log("✓ Workflow executed successfully through queue");
      console.log(`  Status: ${updatedExecution.status}`);
      console.log(`  Duration: ${updatedExecution.duration}s`);
      console.log(
        `  Extracted data keys: ${Object.keys(
          updatedExecution.extracted_data
        ).join(", ")}\n`
      );
      return true;
    } else {
      console.error("✗ Execution did not complete or no data extracted\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Basic workflow execution failed:", error.message, "\n");
    return false;
  }
}

async function testWorkflowWithLogs() {
  console.log("Test 2: Workflow Execution with Log Storage");

  const definition: WorkflowDefinition = {
    steps: [
      { id: "nav", type: "navigate", config: { url: "https://example.com" } },
      { id: "wait", type: "wait", config: { duration: 100 } },
      {
        id: "extract",
        type: "extract",
        config: { selector: "p", multiple: true },
      },
    ],
  };

  const workflow = await workflowService.createWorkflow({
    userId: testUserId,
    name: "E2E Test with Logs",
    description: "Test log storage",
    definition,
    status: "active",
  });

  const execution = await executionService.createExecution({
    workflowId: workflow.id,
    userId: testUserId,
  });

  try {
    const job = await queueService.addJob({
      executionId: execution.id,
      workflowId: workflow.id,
      userId: testUserId,
      definition: definition as unknown,
    });

    await processWorkflowJob(job as any);

    const logs = await executionService.getLogs(execution.id, testUserId, {
      page: 1,
      limit: 50,
    });

    if (logs.logs.length > 0) {
      console.log("✓ Logs stored successfully");
      console.log(`  Total logs: ${logs.total}`);
      console.log(
        `  Log levels: ${[...new Set(logs.logs.map((l) => l.level))].join(
          ", "
        )}\n`
      );
      return true;
    } else {
      console.error("✗ No logs found in database\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Workflow with logs failed:", error.message, "\n");
    return false;
  }
}

async function testWorkflowWithScreenshot() {
  console.log("Test 3: Workflow with Screenshot Upload");

  const definition: WorkflowDefinition = {
    steps: [
      { id: "nav", type: "navigate", config: { url: "https://example.com" } },
      { id: "screenshot", type: "screenshot", config: { fullPage: true } },
    ],
  };

  const workflow = await workflowService.createWorkflow({
    userId: testUserId,
    name: "E2E Test Screenshot",
    description: "Test screenshot upload",
    definition,
    status: "active",
  });

  const execution = await executionService.createExecution({
    workflowId: workflow.id,
    userId: testUserId,
  });

  try {
    const job = await queueService.addJob({
      executionId: execution.id,
      workflowId: workflow.id,
      userId: testUserId,
      definition: definition as unknown,
    });

    await processWorkflowJob(job as any);

    const logs = await executionService.getLogs(execution.id, testUserId, {
      page: 1,
      limit: 50,
    });
    const screenshotLog = logs.logs.find((log) =>
      log.message.includes("Screenshot saved")
    );

    if (screenshotLog) {
      console.log("✓ Screenshot uploaded successfully");
      console.log(`  Log message: ${screenshotLog.message}\n`);
      return true;
    } else {
      console.error("✗ Screenshot upload log not found\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Workflow with screenshot failed:", error.message, "\n");
    return false;
  }
}

async function testFailedWorkflow() {
  console.log("Test 4: Failed Workflow Handling");

  const definition: WorkflowDefinition = {
    steps: [
      { id: "nav", type: "navigate", config: { url: "https://example.com" } },
      {
        id: "bad",
        type: "extract",
        config: { selector: ".nonexistent-selector-xyz" },
      },
    ],
  };

  const workflow = await workflowService.createWorkflow({
    userId: testUserId,
    name: "E2E Test Failed",
    description: "Test failure handling",
    definition,
    status: "active",
  });

  const execution = await executionService.createExecution({
    workflowId: workflow.id,
    userId: testUserId,
  });

  try {
    const job = await queueService.addJob({
      executionId: execution.id,
      workflowId: workflow.id,
      userId: testUserId,
      definition: definition as unknown,
    });

    try {
      await processWorkflowJob(job as any);
    } catch (error) {
      // Expected to fail
    }

    const updatedExecution = await executionService.getExecutionById(
      execution.id,
      testUserId
    );

    if (
      updatedExecution?.status === "failed" &&
      updatedExecution.error_message
    ) {
      console.log("✓ Failed workflow handled correctly");
      console.log(`  Status: ${updatedExecution.status}`);
      console.log(
        `  Error: ${updatedExecution.error_message.substring(0, 50)}...\n`
      );
      return true;
    } else {
      console.error("✗ Execution should have failed status\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Failed workflow test error:", error.message, "\n");
    return false;
  }
}

async function testMultiStepWorkflow() {
  console.log("Test 5: Multi-Step Complex Workflow");

  const definition: WorkflowDefinition = {
    steps: [
      { id: "nav", type: "navigate", config: { url: "https://example.com" } },
      {
        id: "wait1",
        type: "wait",
        config: { selector: "h1", state: "visible" },
      },
      { id: "title", type: "extract", config: { selector: "h1" } },
      {
        id: "paragraphs",
        type: "extract",
        config: { selector: "p", multiple: true },
      },
      {
        id: "links",
        type: "extract",
        config: { selector: "a", attribute: "href", multiple: true },
      },
      { id: "wait2", type: "wait", config: { duration: 200 } },
      { id: "scroll", type: "scroll", config: { y: 100 } },
    ],
  };

  const workflow = await workflowService.createWorkflow({
    userId: testUserId,
    name: "E2E Complex Workflow",
    description: "Multi-step workflow test",
    definition,
    status: "active",
  });

  const execution = await executionService.createExecution({
    workflowId: workflow.id,
    userId: testUserId,
  });

  try {
    const job = await queueService.addJob({
      executionId: execution.id,
      workflowId: workflow.id,
      userId: testUserId,
      definition: definition as unknown,
    });

    await processWorkflowJob(job as any);

    const updatedExecution = await executionService.getExecutionById(
      execution.id,
      testUserId
    );
    const logs = await executionService.getLogs(execution.id, testUserId, {
      page: 1,
      limit: 100,
    });

    if (
      updatedExecution?.status === "completed" &&
      Object.keys(updatedExecution.extracted_data || {}).length >= 3
    ) {
      console.log("✓ Multi-step workflow completed successfully");
      console.log(`  Steps: ${definition.steps.length}`);
      console.log(
        `  Extracted data keys: ${
          Object.keys(updatedExecution.extracted_data!).length
        }`
      );
      console.log(`  Total logs: ${logs.total}\n`);
      return true;
    } else {
      console.error("✗ Multi-step workflow did not complete successfully\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Multi-step workflow failed:", error.message, "\n");
    return false;
  }
}

async function testQueueStatus() {
  console.log("Test 6: Queue Status Tracking");

  try {
    const status = await queueService.getQueueMetrics();

    console.log("✓ Queue status retrieved successfully");
    console.log(`  Waiting: ${status.waiting}`);
    console.log(`  Active: ${status.active}`);
    console.log(`  Completed: ${status.completed}`);
    console.log(`  Failed: ${status.failed}\n`);
    return true;
  } catch (error: any) {
    console.error("✗ Queue status failed:", error.message, "\n");
    return false;
  }
}

async function runAllTests() {
  try {
    await setupTestUser();

    const results = [];
    results.push(await testBasicWorkflowExecution());
    results.push(await testWorkflowWithLogs());
    results.push(await testWorkflowWithScreenshot());
    results.push(await testFailedWorkflow());
    results.push(await testMultiStepWorkflow());
    results.push(await testQueueStatus());

    const passed = results.filter(Boolean).length;
    const total = results.length;

    console.log("=".repeat(50));
    console.log(`Results: ${passed}/${total} tests passed`);
    console.log("=".repeat(50));

    if (passed === total) {
      console.log("✅ ALL TESTS PASSED - PART 5 COMPLETE");
      console.log("🎉 PHASE 3 COMPLETE - AUTOMATION ENGINE FULLY INTEGRATED\n");
    } else {
      console.log("❌ SOME TESTS FAILED\n");
      process.exit(1);
    }
  } catch (error: any) {
    console.error("Fatal test error:", error);
    process.exit(1);
  } finally {
    await cleanupTestUser();
    await queueService.close();
    process.exit(0);
  }
}

runAllTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

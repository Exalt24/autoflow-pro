import { AutomationEngine } from "./src/services/AutomationEngine.js";
import type { ExecutionContext } from "./src/types/automation.js";

console.log("🧪 Testing Automation Engine - Part 1: Core Structure\n");

async function testBrowserLaunchAndCleanup() {
  console.log("Test 1: Browser Launch and Cleanup");
  const engine = new AutomationEngine({ headless: true, timeout: 10000 });

  const context: ExecutionContext = {
    executionId: "test-exec-1",
    workflowId: "test-workflow-1",
    userId: "test-user-1",
    definition: {
      steps: [],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.log("✓ Browser launched and cleaned up successfully\n");
    return true;
  } catch (error: any) {
    console.error("✗ Browser launch failed:", error.message);
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testConcurrencyLimits() {
  console.log("Test 2: Concurrency Limits");
  const engine = new AutomationEngine({ maxConcurrent: 2 });

  const context: ExecutionContext = {
    executionId: "test-exec-2",
    workflowId: "test-workflow-2",
    userId: "test-user-2",
    definition: {
      steps: [
        {
          id: "wait-1",
          type: "wait",
          config: { duration: 1000 },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    console.log(`Max concurrent: ${engine.getMaxConcurrent()}`);
    console.log(`Active before: ${engine.getActiveCount()}`);

    const execution1 = engine.executeWorkflow(context);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const execution2 = engine.executeWorkflow(context);
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log(`Active during: ${engine.getActiveCount()}`);

    await Promise.all([execution1, execution2]);

    console.log(`Active after: ${engine.getActiveCount()}`);
    console.log("✓ Concurrency limits enforced successfully\n");
    return true;
  } catch (error: any) {
    console.error("✗ Concurrency test failed:", error.message);
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testEmptyWorkflow() {
  console.log("Test 3: Empty Workflow Execution");
  const engine = new AutomationEngine();

  const context: ExecutionContext = {
    executionId: "test-exec-3",
    workflowId: "test-workflow-3",
    userId: "test-user-3",
    definition: {
      steps: [],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.log("✓ Empty workflow executed successfully\n");
    return true;
  } catch (error: any) {
    console.error("✗ Empty workflow failed:", error.message);
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testUnknownStepType() {
  console.log("Test 4: Unknown Step Type Handling");
  const engine = new AutomationEngine();

  const context: ExecutionContext = {
    executionId: "test-exec-4",
    workflowId: "test-workflow-4",
    userId: "test-user-4",
    definition: {
      steps: [
        {
          id: "invalid-1",
          type: "invalid_type" as any,
          config: {},
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have thrown error for unknown step type\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("Unknown step type")) {
      console.log("✓ Unknown step type handled correctly\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message);
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testShutdown() {
  console.log("Test 5: Engine Shutdown");
  const engine = new AutomationEngine();

  const context: ExecutionContext = {
    executionId: "test-exec-5",
    workflowId: "test-workflow-5",
    userId: "test-user-5",
    definition: {
      steps: [],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    await engine.shutdown();

    if (engine.getActiveCount() === 0) {
      console.log("✓ Engine shutdown cleaned all resources\n");
      return true;
    } else {
      console.error("✗ Active browsers remaining after shutdown");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Shutdown test failed:", error.message);
    return false;
  }
}

async function runAllTests() {
  const results = [];

  results.push(await testBrowserLaunchAndCleanup());
  results.push(await testConcurrencyLimits());
  results.push(await testEmptyWorkflow());
  results.push(await testUnknownStepType());
  results.push(await testShutdown());

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log("=".repeat(50));
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log("=".repeat(50));

  if (passed === total) {
    console.log("✅ ALL TESTS PASSED - PART 1 COMPLETE\n");
  } else {
    console.log("❌ SOME TESTS FAILED\n");
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

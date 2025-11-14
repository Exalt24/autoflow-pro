import { AutomationEngine } from "./src/services/AutomationEngine.js";
import type {
  ExecutionContext,
  ExecutionCallbacks,
} from "./src/types/automation.js";

console.log("🧪 Testing Automation Engine - Part 4: Integration\n");

async function testProgressTracking() {
  console.log("Test 1: Progress Tracking");
  const engine = new AutomationEngine({ headless: true });

  const progressUpdates: number[] = [];
  const callbacks: ExecutionCallbacks = {
    onProgress: async (progress) => {
      progressUpdates.push(progress.percentage);
    },
  };

  const context: ExecutionContext = {
    executionId: "test-progress-1",
    workflowId: "test-workflow-1",
    userId: "test-user-1",
    definition: {
      steps: [
        {
          id: "step-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        { id: "step-2", type: "wait", config: { duration: 100 } },
        { id: "step-3", type: "extract", config: { selector: "h1" } },
        { id: "step-4", type: "wait", config: { duration: 100 } },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, callbacks);

    if (progressUpdates.length === 4 && progressUpdates[3] === 100) {
      console.log("✓ Progress tracking working");
      console.log(`  Progress updates: ${progressUpdates.join("% → ")}%\n`);
      return true;
    } else {
      console.error(
        `✗ Expected 4 progress updates ending at 100%, got: ${progressUpdates.join(
          ", "
        )}\n`
      );
      return false;
    }
  } catch (error: any) {
    console.error("✗ Progress tracking test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testLogCallbacks() {
  console.log("Test 2: Log Callbacks");
  const engine = new AutomationEngine({ headless: true });

  const logs: Array<{ level: string; message: string }> = [];
  const callbacks: ExecutionCallbacks = {
    onLog: async (log) => {
      logs.push({ level: log.level, message: log.message });
    },
  };

  const context: ExecutionContext = {
    executionId: "test-log-1",
    workflowId: "test-workflow-2",
    userId: "test-user-2",
    definition: {
      steps: [
        {
          id: "step-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        { id: "step-2", type: "extract", config: { selector: "h1" } },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, callbacks);

    const infoLogs = logs.filter((log) => log.level === "info");
    if (infoLogs.length >= 5) {
      console.log("✓ Log callbacks working");
      console.log(`  Total logs: ${logs.length}`);
      console.log(`  Info logs: ${infoLogs.length}\n`);
      return true;
    } else {
      console.error(
        `✗ Expected at least 5 info logs, got ${infoLogs.length}\n`
      );
      return false;
    }
  } catch (error: any) {
    console.error("✗ Log callbacks test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testStepCompleteCallbacks() {
  console.log("Test 3: Step Complete Callbacks");
  const engine = new AutomationEngine({ headless: true });

  const completedSteps: string[] = [];
  const callbacks: ExecutionCallbacks = {
    onStepComplete: async (stepId, result) => {
      if (result.success) {
        completedSteps.push(stepId);
      }
    },
  };

  const context: ExecutionContext = {
    executionId: "test-step-1",
    workflowId: "test-workflow-3",
    userId: "test-user-3",
    definition: {
      steps: [
        {
          id: "nav-step",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        { id: "extract-step", type: "extract", config: { selector: "h1" } },
        { id: "wait-step", type: "wait", config: { duration: 100 } },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, callbacks);

    if (
      completedSteps.length === 3 &&
      completedSteps.includes("extract-step")
    ) {
      console.log("✓ Step complete callbacks working");
      console.log(`  Completed steps: ${completedSteps.join(", ")}\n`);
      return true;
    } else {
      console.error(
        `✗ Expected 3 completed steps, got ${completedSteps.length}\n`
      );
      return false;
    }
  } catch (error: any) {
    console.error(
      "✗ Step complete callbacks test failed:",
      error.message,
      "\n"
    );
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testCompleteCallback() {
  console.log("Test 4: Completion Callback");
  const engine = new AutomationEngine({ headless: true });

  let completionCalled = false;
  let extractedData: Record<string, unknown> = {};

  const callbacks: ExecutionCallbacks = {
    onComplete: async (data) => {
      completionCalled = true;
      extractedData = data;
    },
  };

  const context: ExecutionContext = {
    executionId: "test-complete-1",
    workflowId: "test-workflow-4",
    userId: "test-user-4",
    definition: {
      steps: [
        { id: "nav", type: "navigate", config: { url: "https://example.com" } },
        { id: "title", type: "extract", config: { selector: "h1" } },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, callbacks);

    if (completionCalled && extractedData["title"]) {
      console.log("✓ Completion callback working");
      console.log(
        `  Extracted data keys: ${Object.keys(extractedData).join(", ")}\n`
      );
      return true;
    } else {
      console.error("✗ Completion callback not called or data missing\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Completion callback test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testErrorCallback() {
  console.log("Test 5: Error Callback");
  const engine = new AutomationEngine({ headless: true });

  let errorCalled = false;
  let errorStepId: string | undefined;

  const callbacks: ExecutionCallbacks = {
    onError: async (error, stepId) => {
      errorCalled = true;
      errorStepId = stepId;
    },
  };

  const context: ExecutionContext = {
    executionId: "test-error-1",
    workflowId: "test-workflow-5",
    userId: "test-user-5",
    definition: {
      steps: [
        { id: "nav", type: "navigate", config: { url: "https://example.com" } },
        {
          id: "bad-extract",
          type: "extract",
          config: { selector: ".nonexistent-selector-12345" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, callbacks);
    console.error("✗ Should have thrown error for nonexistent selector\n");
    return false;
  } catch (error: any) {
    if (errorCalled && errorStepId === "bad-extract") {
      console.log("✓ Error callback working");
      console.log(`  Error step: ${errorStepId}\n`);
      return true;
    } else {
      console.error("✗ Error callback not called or wrong step ID\n");
      return false;
    }
  } finally {
    await engine.shutdown();
  }
}

async function testEstimatedTimeRemaining() {
  console.log("Test 6: Estimated Time Remaining");
  const engine = new AutomationEngine({ headless: true });

  let hasEstimate = false;

  const callbacks: ExecutionCallbacks = {
    onProgress: async (progress) => {
      if (
        progress.estimatedTimeRemaining !== undefined &&
        progress.currentStep > 1
      ) {
        hasEstimate = true;
      }
    },
  };

  const context: ExecutionContext = {
    executionId: "test-eta-1",
    workflowId: "test-workflow-6",
    userId: "test-user-6",
    definition: {
      steps: [
        {
          id: "step-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        { id: "step-2", type: "wait", config: { duration: 200 } },
        { id: "step-3", type: "extract", config: { selector: "h1" } },
        { id: "step-4", type: "wait", config: { duration: 200 } },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, callbacks);

    if (hasEstimate) {
      console.log("✓ Estimated time remaining calculated\n");
      return true;
    } else {
      console.error("✗ No estimated time remaining in progress updates\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ ETA test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testAllCallbacksTogether() {
  console.log("Test 7: All Callbacks Together");
  const engine = new AutomationEngine({ headless: true });

  const events: string[] = [];

  const callbacks: ExecutionCallbacks = {
    onProgress: async (progress) => {
      events.push(`progress:${progress.percentage}%`);
    },
    onLog: async (log) => {
      events.push(`log:${log.level}`);
    },
    onStepComplete: async (stepId) => {
      events.push(`complete:${stepId}`);
    },
    onComplete: async () => {
      events.push("workflow:complete");
    },
  };

  const context: ExecutionContext = {
    executionId: "test-all-1",
    workflowId: "test-workflow-7",
    userId: "test-user-7",
    definition: {
      steps: [
        { id: "s1", type: "navigate", config: { url: "https://example.com" } },
        { id: "s2", type: "extract", config: { selector: "h1" } },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, callbacks);

    const hasProgress = events.some((e) => e.startsWith("progress:"));
    const hasLogs = events.some((e) => e.startsWith("log:"));
    const hasComplete = events.includes("workflow:complete");

    if (hasProgress && hasLogs && hasComplete) {
      console.log("✓ All callbacks working together");
      console.log(`  Total events: ${events.length}`);
      console.log(
        `  Event types: progress, log, complete, workflow:complete\n`
      );
      return true;
    } else {
      console.error("✗ Some callbacks not triggered\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ All callbacks test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testBackwardCompatibility() {
  console.log("Test 8: Backward Compatibility (No Callbacks)");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-compat-1",
    workflowId: "test-workflow-8",
    userId: "test-user-8",
    definition: {
      steps: [
        { id: "nav", type: "navigate", config: { url: "https://example.com" } },
        { id: "extract", type: "extract", config: { selector: "h1" } },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    if (context.extractedData["extract"]) {
      console.log(
        "✓ Backward compatibility maintained (works without callbacks)\n"
      );
      return true;
    } else {
      console.error("✗ Workflow failed without callbacks\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Backward compatibility test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function runAllTests() {
  const results = [];

  results.push(await testProgressTracking());
  results.push(await testLogCallbacks());
  results.push(await testStepCompleteCallbacks());
  results.push(await testCompleteCallback());
  results.push(await testErrorCallback());
  results.push(await testEstimatedTimeRemaining());
  results.push(await testAllCallbacksTogether());
  results.push(await testBackwardCompatibility());

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log("=".repeat(50));
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log("=".repeat(50));

  if (passed === total) {
    console.log("✅ ALL TESTS PASSED - PART 4 COMPLETE\n");
  } else {
    console.log("❌ SOME TESTS FAILED\n");
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

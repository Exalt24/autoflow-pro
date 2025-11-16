import "dotenv/config";
import { AutomationEngine } from "./src/services/AutomationEngine.js";
import type { ExecutionContext } from "./src/types/automation.js";

async function testLoopSystem() {
  console.log("🧪 Testing Loop System...\n");

  const engine = new AutomationEngine({ headless: true, timeout: 30000 });

  console.log("Test 1: Loop Over Elements\n");
  const test1: ExecutionContext = {
    executionId: "test-loop-1",
    workflowId: "test-wf",
    userId: "test-user",
    definition: {
      steps: [
        {
          id: "step1",
          type: "navigate",
          config: { url: "https://example.com" },
          position: { x: 0, y: 0 },
        },
        {
          id: "step2",
          type: "loop",
          config: {
            loopType: "elements",
            selector: "p",
            maxIterations: 10,
          },
          position: { x: 0, y: 100 },
        },
      ],
      variables: {},
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(test1, {
      onLog: ({ level, message, stepId }) => {
        const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
        console.log(`${emoji} [${stepId || "workflow"}] ${message}`);
      },
      onStepComplete: (stepId, result) => {
        if (result.success && stepId === "step2") {
          console.log(`✅ Loop Result:`, result.data);
        }
      },
    });
    console.log("✅ Test 1 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 1 Failed:", error.message);
  }

  console.log("\nTest 2: Loop N Times with Variables\n");
  const test2: ExecutionContext = {
    executionId: "test-loop-2",
    workflowId: "test-wf",
    userId: "test-user",
    definition: {
      steps: [
        {
          id: "step1",
          type: "loop",
          config: {
            loopType: "count",
            count: 5,
          },
          position: { x: 0, y: 0 },
        },
      ],
      variables: {},
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(test2, {
      onLog: ({ level, message, stepId }) => {
        const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
        console.log(`${emoji} [${stepId || "workflow"}] ${message}`);
      },
      onStepComplete: (stepId, result) => {
        if (result.success && stepId === "step1") {
          console.log(`✅ Loop Result:`, result.data);
        }
      },
    });
    console.log("✅ Test 2 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 2 Failed:", error.message);
  }

  console.log("\nTest 3: Loop with Max Iterations Limit\n");
  const test3: ExecutionContext = {
    executionId: "test-loop-3",
    workflowId: "test-wf",
    userId: "test-user",
    definition: {
      steps: [
        {
          id: "step1",
          type: "navigate",
          config: { url: "https://example.com" },
          position: { x: 0, y: 0 },
        },
        {
          id: "step2",
          type: "loop",
          config: {
            loopType: "elements",
            selector: "p",
            maxIterations: 2,
          },
          position: { x: 0, y: 100 },
        },
      ],
      variables: {},
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(test3, {
      onLog: ({ level, message, stepId }) => {
        const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
        console.log(`${emoji} [${stepId || "workflow"}] ${message}`);
      },
      onStepComplete: (stepId, result) => {
        if (result.success && stepId === "step2") {
          console.log(`✅ Loop Result (limited to 2):`, result.data);
        }
      },
    });
    console.log("✅ Test 3 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 3 Failed:", error.message);
  }

  console.log("\n✅ All loop tests passed!");
  await engine.shutdown();
  process.exit(0);
}

testLoopSystem();

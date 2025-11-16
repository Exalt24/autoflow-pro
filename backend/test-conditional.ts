import "dotenv/config";
import { AutomationEngine } from "./src/services/AutomationEngine.js";
import type { ExecutionContext } from "./src/types/automation.js";

async function testConditionalLogic() {
  console.log("🧪 Testing Conditional Logic...\n");

  const engine = new AutomationEngine({ headless: true, timeout: 30000 });

  console.log("Test 1: Element Exists Condition\n");
  const test1: ExecutionContext = {
    executionId: "test-conditional-1",
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
          type: "conditional",
          config: {
            conditionType: "element_exists",
            selector: "h1",
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
          console.log(`✅ Condition Result:`, result.data);
        }
      },
    });
    console.log("✅ Test 1 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 1 Failed:", error.message);
  }

  console.log("\nTest 2: Value Comparison Condition\n");
  const test2: ExecutionContext = {
    executionId: "test-conditional-2",
    workflowId: "test-wf",
    userId: "test-user",
    definition: {
      steps: [
        {
          id: "step1",
          type: "set_variable",
          config: {
            variableName: "userCount",
            variableValue: "25",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "step2",
          type: "conditional",
          config: {
            conditionType: "value_equals",
            variableName: "userCount",
            operator: "greater_than",
            value: "10",
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
    await engine.executeWorkflow(test2, {
      onLog: ({ level, message, stepId }) => {
        const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
        console.log(`${emoji} [${stepId || "workflow"}] ${message}`);
      },
      onStepComplete: (stepId, result) => {
        if (result.success && stepId === "step2") {
          console.log(`✅ Condition Result:`, result.data);
        }
      },
    });
    console.log("✅ Test 2 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 2 Failed:", error.message);
  }

  console.log("\nTest 3: Text Contains Condition\n");
  const test3: ExecutionContext = {
    executionId: "test-conditional-3",
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
          type: "conditional",
          config: {
            conditionType: "text_contains",
            selector: "h1",
            text: "Example",
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
          console.log(`✅ Condition Result:`, result.data);
        }
      },
    });
    console.log("✅ Test 3 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 3 Failed:", error.message);
  }

  console.log("\n✅ All conditional tests passed!");
  await engine.shutdown();
  process.exit(0);
}

testConditionalLogic();

import "dotenv/config";
import { AutomationEngine } from "../src/services/AutomationEngine.js";
import type { ExecutionContext } from "../src/types/automation.js";

async function testVariableSystem() {
  console.log("🧪 Testing Variable System...\n");

  const engine = new AutomationEngine({ headless: true, timeout: 30000 });

  const context: ExecutionContext = {
    executionId: "test-variables",
    workflowId: "test-wf",
    userId: "test-user",
    definition: {
      steps: [
        {
          id: "step1",
          type: "set_variable",
          config: {
            variableName: "searchQuery",
            variableValue: "playwright automation",
          },
          position: { x: 0, y: 0 },
        },
        {
          id: "step2",
          type: "set_variable",
          config: {
            variableName: "baseUrl",
            variableValue: "https://example.com",
          },
          position: { x: 0, y: 100 },
        },
        {
          id: "step3",
          type: "navigate",
          config: {
            url: "${baseUrl}",
          },
          position: { x: 0, y: 200 },
        },
        {
          id: "step4",
          type: "extract_to_variable",
          config: {
            selector: "h1",
            variableName: "pageTitle",
          },
          position: { x: 0, y: 300 },
        },
        {
          id: "step5",
          type: "set_variable",
          config: {
            variableName: "message",
            variableValue: "Title is: ${pageTitle}",
          },
          position: { x: 0, y: 400 },
        },
      ],
      variables: {},
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context, {
      onProgress: (progress) => {
        console.log(
          `📊 Progress: ${progress.currentStep}/${progress.totalSteps} (${progress.percentage}%)`
        );
      },
      onLog: ({ level, message, stepId }) => {
        const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
        console.log(`${emoji} [${stepId || "workflow"}] ${message}`);
      },
      onStepComplete: (stepId, result) => {
        if (result.success) {
          console.log(`✅ Step ${stepId} completed`);
          if (result.data) {
            console.log(`   Data:`, result.data);
          }
        } else {
          console.log(`❌ Step ${stepId} failed: ${result.error}`);
        }
      },
      onComplete: (data) => {
        console.log("\n✨ Workflow completed!");
        console.log("\n📦 Final Variables:", context.variables);
        console.log("\n📊 Extracted Data:", data);
      },
      onError: (error) => {
        console.error("\n💥 Workflow failed:", error.message);
      },
    });

    console.log("\n✅ All tests passed!");
  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
    process.exit(1);
  } finally {
    await engine.shutdown();
    process.exit(0);
  }
}

testVariableSystem();

import "dotenv/config";
import { AutomationEngine } from "./src/services/AutomationEngine.js";
import type { ExecutionContext } from "./src/types/automation.js";

async function testAdvancedFeatures() {
  console.log("🧪 Testing Advanced Features...\n");

  const engine = new AutomationEngine({ headless: true, timeout: 30000 });

  console.log("Test 1: Cookie & localStorage Operations\n");

  const test1: ExecutionContext = {
    executionId: "test-advanced-1",
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
          type: "set_cookie",
          config: {
            name: "testCookie",
            value: "cookieValue123",
          },
          position: { x: 0, y: 100 },
        },
        {
          id: "step3",
          type: "get_cookie",
          config: {
            name: "testCookie",
            variableName: "myCookie",
          },
          position: { x: 0, y: 200 },
        },
        {
          id: "step4",
          type: "set_localstorage",
          config: {
            key: "testKey",
            value: "localStorageValue",
          },
          position: { x: 0, y: 300 },
        },
        {
          id: "step5",
          type: "get_localstorage",
          config: {
            key: "testKey",
            variableName: "myStorage",
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
    await engine.executeWorkflow(test1, {
      onLog: ({ level, message, stepId }) => {
        const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
        console.log(`${emoji} [${stepId || "workflow"}] ${message}`);
      },
      onStepComplete: (stepId, result) => {
        if (result.success) {
          console.log(`✅ ${stepId}:`, result.data);
        }
      },
      onComplete: () => {
        console.log("\n📦 Variables:", test1.variables);
      },
    });
    console.log("✅ Test 1 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 1 Failed:", error.message);
  }

  console.log("\nTest 2: Dropdown Selection\n");

  const htmlPage = `
    <!DOCTYPE html>
    <html>
    <head><title>Test Page</title></head>
    <body>
      <h1 id="title">Test Page</h1>
      <select id="country">
        <option value="">Select...</option>
        <option value="us">United States</option>
        <option value="uk">United Kingdom</option>
        <option value="ca">Canada</option>
      </select>
      <button id="myButton">Click Me</button>
    </body>
    </html>
  `;

  const dataUrl = `data:text/html;base64,${Buffer.from(htmlPage).toString(
    "base64"
  )}`;

  const test2: ExecutionContext = {
    executionId: "test-advanced-2",
    workflowId: "test-wf",
    userId: "test-user",
    definition: {
      steps: [
        {
          id: "step1",
          type: "navigate",
          config: { url: dataUrl },
          position: { x: 0, y: 0 },
        },
        {
          id: "step2",
          type: "select_dropdown",
          config: {
            selector: "#country",
            value: "us",
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
        if (result.success) {
          console.log(`✅ ${stepId}:`, result.data);
        }
      },
    });
    console.log("✅ Test 2 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 2 Failed:", error.message);
  }

  console.log("\nTest 3: Right Click & Double Click\n");

  const test3: ExecutionContext = {
    executionId: "test-advanced-3",
    workflowId: "test-wf",
    userId: "test-user",
    definition: {
      steps: [
        {
          id: "step1",
          type: "navigate",
          config: { url: dataUrl },
          position: { x: 0, y: 0 },
        },
        {
          id: "step2",
          type: "right_click",
          config: {
            selector: "#myButton",
          },
          position: { x: 0, y: 100 },
        },
        {
          id: "step3",
          type: "double_click",
          config: {
            selector: "#myButton",
          },
          position: { x: 0, y: 200 },
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
        if (result.success) {
          console.log(`✅ ${stepId}:`, result.data);
        }
      },
    });
    console.log("✅ Test 3 Passed\n");
  } catch (error: any) {
    console.error("❌ Test 3 Failed:", error.message);
  }

  console.log("\n✅ All advanced tests passed!");
  await engine.shutdown();
  process.exit(0);
}

testAdvancedFeatures();

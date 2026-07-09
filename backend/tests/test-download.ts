import "dotenv/config";
import { AutomationEngine } from "../src/services/AutomationEngine.js";
import type { ExecutionContext } from "../src/types/automation.js";

async function testDownload() {
  console.log("🧪 Testing File Download...\n");

  const engine = new AutomationEngine({ headless: true, timeout: 30000 });

  console.log("Test: Download File (Mocked)\n");

  const htmlWithDownload = `
    <!DOCTYPE html>
    <html>
    <head><title>Test Download Page</title></head>
    <body>
      <h1>Download Test</h1>
      <a id="download-link" href="data:text/plain;base64,SGVsbG8gV29ybGQhIFRoaXMgaXMgYSB0ZXN0IGZpbGUu" download="test-file.txt">
        Download Test File
      </a>
    </body>
    </html>
  `;

  const dataUrl = `data:text/html;base64,${Buffer.from(
    htmlWithDownload
  ).toString("base64")}`;

  const test: ExecutionContext = {
    executionId: "test-download-1",
    workflowId: "test-wf",
    userId: "test-user-123",
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
          type: "download_file",
          config: {
            triggerMethod: "click",
            selector: "#download-link",
            waitForDownload: true,
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
    await engine.executeWorkflow(test, {
      onLog: ({ level, message, stepId }) => {
        const emoji = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
        console.log(`${emoji} [${stepId || "workflow"}] ${message}`);
      },
      onStepComplete: (stepId, result) => {
        if (result.success && stepId === "step2") {
          console.log(`✅ Download Result:`, result.data);
        }
      },
      onComplete: (data) => {
        console.log("\n✨ Workflow completed!");
        console.log("📦 Extracted Data:", data);
      },
    });
    console.log("\n✅ Download test passed!");
  } catch (error: any) {
    console.error("\n❌ Test failed:", error.message);
    console.log(
      "\n💡 Note: This requires Supabase credentials to upload files."
    );
    console.log(
      "   Check your .env file has SUPABASE_URL and SUPABASE_SERVICE_KEY"
    );
  } finally {
    await engine.shutdown();
    process.exit(0);
  }
}

testDownload();

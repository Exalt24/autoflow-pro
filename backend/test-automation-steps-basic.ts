import { AutomationEngine } from "./src/services/AutomationEngine.js";
import type { ExecutionContext } from "./src/types/automation.js";

console.log("🧪 Testing Automation Engine - Part 2: Basic Steps\n");

async function testNavigate() {
  console.log("Test 1: Navigate to URL");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-nav-1",
    workflowId: "test-workflow-1",
    userId: "test-user-1",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    if (context.extractedData["nav-1"]) {
      console.log("✓ Navigate step executed successfully");
      console.log(
        `  URL reached: ${(context.extractedData["nav-1"] as any).url}\n`
      );
      return true;
    } else {
      console.error("✗ Navigate step did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Navigate test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testNavigateInvalidUrl() {
  console.log("Test 2: Navigate with Invalid URL");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-nav-2",
    workflowId: "test-workflow-2",
    userId: "test-user-2",
    definition: {
      steps: [
        {
          id: "nav-2",
          type: "navigate",
          config: { url: "invalid-url" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed with invalid URL\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("Navigation failed")) {
      console.log("✓ Invalid URL handled correctly\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testNavigateMissingUrl() {
  console.log("Test 3: Navigate without URL");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-nav-3",
    workflowId: "test-workflow-3",
    userId: "test-user-3",
    definition: {
      steps: [
        {
          id: "nav-3",
          type: "navigate",
          config: {},
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed without URL\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("URL is required")) {
      console.log("✓ Missing URL validation working\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testClick() {
  console.log("Test 4: Click Element");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-click-1",
    workflowId: "test-workflow-4",
    userId: "test-user-4",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "click-1",
          type: "click",
          config: { selector: "a" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    if (context.extractedData["click-1"]) {
      console.log("✓ Click step executed successfully\n");
      return true;
    } else {
      console.error("✗ Click step did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Click test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testClickMissingSelector() {
  console.log("Test 5: Click without Selector");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-click-2",
    workflowId: "test-workflow-5",
    userId: "test-user-5",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "click-2",
          type: "click",
          config: {},
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed without selector\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("Selector is required")) {
      console.log("✓ Missing selector validation working\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testFill() {
  console.log("Test 6: Fill Input Field");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-fill-1",
    workflowId: "test-workflow-6",
    userId: "test-user-6",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://www.bing.com" },
        },
        {
          id: "fill-1",
          type: "fill",
          config: {
            selector: "#sb_form_q",
            value: "playwright automation",
          },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    if (context.extractedData["fill-1"]) {
      const data = context.extractedData["fill-1"] as any;
      console.log("✓ Fill step executed successfully");
      console.log(`  Filled: ${data.value}\n`);
      return true;
    } else {
      console.error("✗ Fill step did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Fill test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testFillMissingValue() {
  console.log("Test 7: Fill without Value");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-fill-2",
    workflowId: "test-workflow-7",
    userId: "test-user-7",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://www.bing.com" },
        },
        {
          id: "fill-2",
          type: "fill",
          config: { selector: "#sb_form_q" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed without value\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("Value is required")) {
      console.log("✓ Missing value validation working\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testWaitDuration() {
  console.log("Test 8: Wait for Duration");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-wait-1",
    workflowId: "test-workflow-8",
    userId: "test-user-8",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
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

  const startTime = Date.now();

  try {
    await engine.executeWorkflow(context);
    const elapsed = Date.now() - startTime;

    if (elapsed >= 1000 && context.extractedData["wait-1"]) {
      console.log("✓ Wait duration executed successfully");
      console.log(`  Elapsed: ${elapsed}ms\n`);
      return true;
    } else {
      console.error("✗ Wait duration did not wait correctly\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Wait duration test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testWaitElement() {
  console.log("Test 9: Wait for Element");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-wait-2",
    workflowId: "test-workflow-9",
    userId: "test-user-9",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "wait-2",
          type: "wait",
          config: { selector: "h1", state: "visible" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    if (context.extractedData["wait-2"]) {
      console.log("✓ Wait for element executed successfully\n");
      return true;
    } else {
      console.error("✗ Wait for element did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Wait for element test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testWaitMissingConfig() {
  console.log("Test 10: Wait without Duration or Selector");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-wait-3",
    workflowId: "test-workflow-10",
    userId: "test-user-10",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "wait-3",
          type: "wait",
          config: {},
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed without duration or selector\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("Either duration or selector is required")) {
      console.log("✓ Missing wait config validation working\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testMultiStepWorkflow() {
  console.log("Test 11: Multi-Step Workflow");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-multi-1",
    workflowId: "test-workflow-11",
    userId: "test-user-11",
    definition: {
      steps: [
        {
          id: "step-1",
          type: "navigate",
          config: { url: "https://www.bing.com" },
        },
        {
          id: "step-2",
          type: "wait",
          config: { selector: "#sb_form_q", state: "visible" },
        },
        {
          id: "step-3",
          type: "fill",
          config: {
            selector: "#sb_form_q",
            value: "automation testing",
          },
        },
        {
          id: "step-4",
          type: "wait",
          config: { duration: 500 },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const allStepsCompleted = ["step-1", "step-2", "step-3", "step-4"].every(
      (stepId) => context.extractedData[stepId]
    );

    if (allStepsCompleted) {
      console.log("✓ Multi-step workflow executed successfully");
      console.log(
        `  Steps completed: ${Object.keys(context.extractedData).length}\n`
      );
      return true;
    } else {
      console.error("✗ Not all steps completed\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Multi-step workflow failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function runAllTests() {
  const results = [];

  results.push(await testNavigate());
  results.push(await testNavigateInvalidUrl());
  results.push(await testNavigateMissingUrl());
  results.push(await testClick());
  results.push(await testClickMissingSelector());
  results.push(await testFill());
  results.push(await testFillMissingValue());
  results.push(await testWaitDuration());
  results.push(await testWaitElement());
  results.push(await testWaitMissingConfig());
  results.push(await testMultiStepWorkflow());

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log("=".repeat(50));
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log("=".repeat(50));

  if (passed === total) {
    console.log("✅ ALL TESTS PASSED - PART 2 COMPLETE\n");
  } else {
    console.log("❌ SOME TESTS FAILED\n");
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

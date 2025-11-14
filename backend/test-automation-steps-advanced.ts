import { AutomationEngine } from "./src/services/AutomationEngine.js";
import type { ExecutionContext } from "./src/types/automation.js";

console.log("🧪 Testing Automation Engine - Part 3: Advanced Steps\n");

async function testExtractText() {
  console.log("Test 1: Extract Text from Element");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-extract-1",
    workflowId: "test-workflow-1",
    userId: "test-user-1",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "extract-1",
          type: "extract",
          config: { selector: "h1" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const extracted = context.extractedData["extract-1"];
    if (extracted && typeof extracted === "string" && extracted.length > 0) {
      console.log("✓ Extract text executed successfully");
      console.log(`  Extracted: "${extracted}"\n`);
      return true;
    } else {
      console.error("✗ Extract did not return text\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Extract text test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testExtractMultiple() {
  console.log("Test 2: Extract Multiple Elements");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-extract-2",
    workflowId: "test-workflow-2",
    userId: "test-user-2",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "extract-2",
          type: "extract",
          config: { selector: "p", multiple: true },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const extracted = context.extractedData["extract-2"];
    if (Array.isArray(extracted) && extracted.length > 0) {
      console.log("✓ Extract multiple executed successfully");
      console.log(`  Extracted ${extracted.length} elements\n`);
      return true;
    } else {
      console.error("✗ Extract multiple did not return array\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Extract multiple test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testExtractAttribute() {
  console.log("Test 3: Extract Attribute Value");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-extract-3",
    workflowId: "test-workflow-3",
    userId: "test-user-3",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "extract-3",
          type: "extract",
          config: { selector: "a", attribute: "href" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const extracted = context.extractedData["extract-3"];
    if (extracted && typeof extracted === "string") {
      console.log("✓ Extract attribute executed successfully");
      console.log(`  Extracted href: "${extracted}"\n`);
      return true;
    } else {
      console.error("✗ Extract attribute did not return value\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Extract attribute test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testExtractMissingSelector() {
  console.log("Test 4: Extract without Selector");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-extract-4",
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
          id: "extract-4",
          type: "extract",
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

async function testScreenshotFullPage() {
  console.log("Test 5: Screenshot Full Page");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-screenshot-1",
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
          id: "screenshot-1",
          type: "screenshot",
          config: { fullPage: true },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const screenshot = context.extractedData["screenshot-1"];
    if (screenshot && Buffer.isBuffer(screenshot)) {
      console.log("✓ Screenshot full page executed successfully");
      console.log(`  Screenshot size: ${screenshot.length} bytes\n`);
      return true;
    } else {
      console.error("✗ Screenshot did not return buffer\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Screenshot test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testScreenshotElement() {
  console.log("Test 6: Screenshot Specific Element");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-screenshot-2",
    workflowId: "test-workflow-6",
    userId: "test-user-6",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "screenshot-2",
          type: "screenshot",
          config: { selector: "h1" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const screenshot = context.extractedData["screenshot-2"];
    if (screenshot && Buffer.isBuffer(screenshot)) {
      console.log("✓ Screenshot element executed successfully");
      console.log(`  Screenshot size: ${screenshot.length} bytes\n`);
      return true;
    } else {
      console.error("✗ Screenshot element did not return buffer\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Screenshot element test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testScrollToElement() {
  console.log("Test 7: Scroll to Element");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-scroll-1",
    workflowId: "test-workflow-7",
    userId: "test-user-7",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "scroll-1",
          type: "scroll",
          config: { selector: "p" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const scrollData = context.extractedData["scroll-1"] as any;
    if (scrollData && scrollData.scrolled === "element") {
      console.log("✓ Scroll to element executed successfully\n");
      return true;
    } else {
      console.error("✗ Scroll to element did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Scroll to element test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testScrollToPosition() {
  console.log("Test 8: Scroll to Position");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-scroll-2",
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
          id: "scroll-2",
          type: "scroll",
          config: { x: 0, y: 100 },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const scrollData = context.extractedData["scroll-2"] as any;
    if (scrollData && scrollData.scrolled === "position") {
      console.log("✓ Scroll to position executed successfully\n");
      return true;
    } else {
      console.error("✗ Scroll to position did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Scroll to position test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testScrollMissingConfig() {
  console.log("Test 9: Scroll without Config");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-scroll-3",
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
          id: "scroll-3",
          type: "scroll",
          config: {},
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed without scroll config\n");
    return false;
  } catch (error: any) {
    if (
      error.message.includes("Either selector or x/y coordinates are required")
    ) {
      console.log("✓ Missing scroll config validation working\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testHover() {
  console.log("Test 10: Hover over Element");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-hover-1",
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
          id: "hover-1",
          type: "hover",
          config: { selector: "a" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const hoverData = context.extractedData["hover-1"] as any;
    if (hoverData && hoverData.hovered) {
      console.log("✓ Hover executed successfully\n");
      return true;
    } else {
      console.error("✗ Hover did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Hover test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testHoverMissingSelector() {
  console.log("Test 11: Hover without Selector");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-hover-2",
    workflowId: "test-workflow-11",
    userId: "test-user-11",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "hover-2",
          type: "hover",
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

async function testPressKey() {
  console.log("Test 12: Press Key");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-key-1",
    workflowId: "test-workflow-12",
    userId: "test-user-12",
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
          config: { selector: "#sb_form_q", value: "test" },
        },
        {
          id: "key-1",
          type: "press_key",
          config: { key: "Enter", selector: "#sb_form_q" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const keyData = context.extractedData["key-1"] as any;
    if (keyData && keyData.pressed === "Enter") {
      console.log("✓ Press key executed successfully\n");
      return true;
    } else {
      console.error("✗ Press key did not return data\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Press key test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testPressKeyMissing() {
  console.log("Test 13: Press Key without Key");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-key-2",
    workflowId: "test-workflow-13",
    userId: "test-user-13",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "key-2",
          type: "press_key",
          config: {},
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed without key\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("Key is required")) {
      console.log("✓ Missing key validation working\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testExecuteJs() {
  console.log("Test 14: Execute JavaScript");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-js-1",
    workflowId: "test-workflow-14",
    userId: "test-user-14",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "js-1",
          type: "execute_js",
          config: { code: "return document.title;" },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const result = context.extractedData["js-1"];
    if (result && typeof result === "string" && result.length > 0) {
      console.log("✓ Execute JavaScript executed successfully");
      console.log(`  Result: "${result}"\n`);
      return true;
    } else {
      console.error("✗ Execute JavaScript did not return result\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Execute JavaScript test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testExecuteJsWithReturn() {
  console.log("Test 15: Execute JavaScript with Complex Return");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-js-2",
    workflowId: "test-workflow-15",
    userId: "test-user-15",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "js-2",
          type: "execute_js",
          config: {
            code: `return {
              url: window.location.href,
              title: document.title,
              links: document.querySelectorAll('a').length
            };`,
          },
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);

    const result = context.extractedData["js-2"] as any;
    if (result && typeof result === "object" && result.url && result.title) {
      console.log(
        "✓ Execute JavaScript with object return executed successfully"
      );
      console.log(`  URL: ${result.url}`);
      console.log(`  Links: ${result.links}\n`);
      return true;
    } else {
      console.error("✗ Execute JavaScript did not return object\n");
      return false;
    }
  } catch (error: any) {
    console.error("✗ Execute JavaScript test failed:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function testExecuteJsMissingCode() {
  console.log("Test 16: Execute JavaScript without Code");
  const engine = new AutomationEngine({ headless: true });

  const context: ExecutionContext = {
    executionId: "test-js-3",
    workflowId: "test-workflow-16",
    userId: "test-user-16",
    definition: {
      steps: [
        {
          id: "nav-1",
          type: "navigate",
          config: { url: "https://example.com" },
        },
        {
          id: "js-3",
          type: "execute_js",
          config: {},
        },
      ],
    },
    variables: {},
    extractedData: {},
  };

  try {
    await engine.executeWorkflow(context);
    console.error("✗ Should have failed without code\n");
    return false;
  } catch (error: any) {
    if (error.message.includes("Code is required")) {
      console.log("✓ Missing code validation working\n");
      return true;
    }
    console.error("✗ Wrong error message:", error.message, "\n");
    return false;
  } finally {
    await engine.shutdown();
  }
}

async function runAllTests() {
  const results = [];

  results.push(await testExtractText());
  results.push(await testExtractMultiple());
  results.push(await testExtractAttribute());
  results.push(await testExtractMissingSelector());
  results.push(await testScreenshotFullPage());
  results.push(await testScreenshotElement());
  results.push(await testScrollToElement());
  results.push(await testScrollToPosition());
  results.push(await testScrollMissingConfig());
  results.push(await testHover());
  results.push(await testHoverMissingSelector());
  results.push(await testPressKey());
  results.push(await testPressKeyMissing());
  results.push(await testExecuteJs());
  results.push(await testExecuteJsWithReturn());
  results.push(await testExecuteJsMissingCode());

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log("=".repeat(50));
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log("=".repeat(50));

  if (passed === total) {
    console.log("✅ ALL TESTS PASSED - PART 3 COMPLETE\n");
  } else {
    console.log("❌ SOME TESTS FAILED\n");
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

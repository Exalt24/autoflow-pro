import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type {
  ExecutionContext,
  StepResult,
  BrowserResources,
  EngineConfig,
  ExecutionCallbacks,
  ExecutionProgress,
} from "../types/automation.js";
import type { WorkflowStep } from "../types/database.js";

export class AutomationEngine {
  private config: EngineConfig;
  private activeBrowsers: Set<Browser> = new Set();
  private maxConcurrent: number;
  private currentConcurrent: number = 0;

  constructor(config?: Partial<EngineConfig>) {
    this.config = {
      headless: true,
      timeout: 30000,
      maxConcurrent: 2,
      screenshotOnError: true,
      ...config,
    };
    this.maxConcurrent = this.config.maxConcurrent;
  }

  async executeWorkflow(
    context: ExecutionContext,
    callbacks?: ExecutionCallbacks
  ): Promise<void> {
    const resources: BrowserResources = {
      browser: null,
      context: null,
      page: null,
    };

    const startTime = Date.now();
    const totalSteps = context.definition.steps.length;

    try {
      await this.waitForAvailableSlot();
      this.currentConcurrent++;

      await this.log(
        callbacks,
        "info",
        `Starting workflow execution: ${context.workflowId}`
      );

      resources.browser = await this.launchBrowser();
      this.activeBrowsers.add(resources.browser);

      resources.context = await resources.browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      });

      resources.page = await resources.context.newPage();
      resources.page.setDefaultTimeout(this.config.timeout);

      for (let i = 0; i < totalSteps; i++) {
        const step = context.definition.steps[i];
        const currentStep = i + 1;

        await this.log(
          callbacks,
          "info",
          `Executing step ${currentStep}/${totalSteps}: ${step.type}`,
          step.id
        );

        const progress: ExecutionProgress = {
          currentStep,
          totalSteps,
          percentage: Math.round((currentStep / totalSteps) * 100),
        };

        if (i > 0) {
          const elapsed = Date.now() - startTime;
          const avgTimePerStep = elapsed / i;
          const stepsRemaining = totalSteps - i;
          progress.estimatedTimeRemaining = Math.round(
            avgTimePerStep * stepsRemaining
          );
        }

        await callbacks?.onProgress?.(progress);

        const result = await this.executeStep(step, resources, context);

        if (!result.success) {
          await this.log(
            callbacks,
            "error",
            `Step failed: ${result.error}`,
            step.id
          );
          await callbacks?.onError?.(new Error(result.error), step.id);
          throw new Error(`Step ${step.id} failed: ${result.error}`);
        }

        if (result.data !== undefined) {
          context.extractedData[step.id] = result.data;
        }

        await this.log(
          callbacks,
          "info",
          `Step ${currentStep} completed successfully`,
          step.id
        );
        await callbacks?.onStepComplete?.(step.id, result);
      }

      const duration = Date.now() - startTime;
      await this.log(
        callbacks,
        "info",
        `Workflow completed successfully in ${duration}ms`
      );
      await callbacks?.onComplete?.(context.extractedData);
    } catch (error: any) {
      if (this.config.screenshotOnError && resources.page) {
        try {
          const screenshot = await resources.page.screenshot({
            fullPage: true,
          });
          await this.log(
            callbacks,
            "info",
            `Error screenshot captured (${screenshot.length} bytes)`
          );
        } catch (screenshotError) {
          await this.log(
            callbacks,
            "error",
            `Failed to capture error screenshot: ${screenshotError}`
          );
        }
      }
      throw error;
    } finally {
      await this.cleanup(resources);
      this.currentConcurrent--;
    }
  }

  private async log(
    callbacks: ExecutionCallbacks | undefined,
    level: "info" | "warn" | "error",
    message: string,
    stepId?: string
  ): Promise<void> {
    await callbacks?.onLog?.({ level, message, stepId });
  }

  private async executeStep(
    step: WorkflowStep,
    resources: BrowserResources,
    context: ExecutionContext
  ): Promise<StepResult> {
    const { page } = resources;
    if (!page) {
      return { success: false, error: "No page available" };
    }

    try {
      switch (step.type) {
        case "navigate":
          return await this.stepNavigate(step, page);
        case "click":
          return await this.stepClick(step, page);
        case "fill":
          return await this.stepFill(step, page);
        case "extract":
          return await this.stepExtract(step, page);
        case "wait":
          return await this.stepWait(step, page);
        case "screenshot":
          return await this.stepScreenshot(step, page);
        case "scroll":
          return await this.stepScroll(step, page);
        case "hover":
          return await this.stepHover(step, page);
        case "press_key":
          return await this.stepPressKey(step, page);
        case "execute_js":
          return await this.stepExecuteJs(step, page);
        default:
          return { success: false, error: `Unknown step type: ${step.type}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async stepNavigate(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    const url = step.config.url as string;
    if (!url) {
      return { success: false, error: "URL is required for navigate step" };
    }

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeout,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 5000 })
        .catch(() => {});
      return { success: true, data: { url: page.url() } };
    } catch (error: any) {
      return { success: false, error: `Navigation failed: ${error.message}` };
    }
  }

  private async stepClick(step: WorkflowStep, page: Page): Promise<StepResult> {
    const selector = step.config.selector as string;
    if (!selector) {
      return { success: false, error: "Selector is required for click step" };
    }

    try {
      await page.waitForSelector(selector, {
        state: "visible",
        timeout: this.config.timeout,
      });
      await page.click(selector);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      return { success: true, data: { clicked: selector } };
    } catch (error: any) {
      return { success: false, error: `Click failed: ${error.message}` };
    }
  }

  private async stepFill(step: WorkflowStep, page: Page): Promise<StepResult> {
    const selector = step.config.selector as string;
    const value = step.config.value as string;

    if (!selector) {
      return { success: false, error: "Selector is required for fill step" };
    }
    if (value === undefined || value === null) {
      return { success: false, error: "Value is required for fill step" };
    }

    try {
      await page.waitForSelector(selector, {
        state: "visible",
        timeout: this.config.timeout,
      });
      await page.fill(selector, String(value));
      return { success: true, data: { filled: selector, value } };
    } catch (error: any) {
      return { success: false, error: `Fill failed: ${error.message}` };
    }
  }

  private async stepExtract(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    const selector = step.config.selector as string;
    const attribute = step.config.attribute as string;
    const multiple = step.config.multiple as boolean;

    if (!selector) {
      return { success: false, error: "Selector is required for extract step" };
    }

    try {
      if (multiple) {
        const elements = await page.locator(selector).all();
        const results = [];

        for (const element of elements) {
          if (attribute) {
            const value = await element.getAttribute(attribute);
            results.push(value);
          } else {
            const text = await element.textContent();
            results.push(text?.trim());
          }
        }

        return { success: true, data: results };
      } else {
        await page.waitForSelector(selector, {
          state: "attached",
          timeout: this.config.timeout,
        });

        if (attribute) {
          const value = await page.getAttribute(selector, attribute);
          return { success: true, data: value };
        } else {
          const text = await page.textContent(selector);
          return { success: true, data: text?.trim() };
        }
      }
    } catch (error: any) {
      return { success: false, error: `Extract failed: ${error.message}` };
    }
  }

  private async stepWait(step: WorkflowStep, page: Page): Promise<StepResult> {
    const duration = step.config.duration as number;
    const selector = step.config.selector as string;
    const state =
      (step.config.state as "visible" | "hidden" | "attached") || "visible";

    if (selector) {
      try {
        await page.waitForSelector(selector, {
          state,
          timeout: this.config.timeout,
        });
        return { success: true, data: { waited: "element", selector, state } };
      } catch (error: any) {
        return {
          success: false,
          error: `Wait for element failed: ${error.message}`,
        };
      }
    }

    if (duration) {
      try {
        await page.waitForTimeout(duration);
        return { success: true, data: { waited: "duration", duration } };
      } catch (error: any) {
        return {
          success: false,
          error: `Wait for duration failed: ${error.message}`,
        };
      }
    }

    return {
      success: false,
      error: "Either duration or selector is required for wait step",
    };
  }

  private async stepScreenshot(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    const selector = step.config.selector as string;
    const fullPage = step.config.fullPage as boolean;

    try {
      let screenshot: Buffer;

      if (selector) {
        await page.waitForSelector(selector, {
          state: "visible",
          timeout: this.config.timeout,
        });
        const element = await page.locator(selector);
        screenshot = await element.screenshot();
      } else {
        screenshot = await page.screenshot({ fullPage: fullPage ?? true });
      }

      return { success: true, data: screenshot, screenshot };
    } catch (error: any) {
      return { success: false, error: `Screenshot failed: ${error.message}` };
    }
  }

  private async stepScroll(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    const selector = step.config.selector as string;
    const x = step.config.x as number;
    const y = step.config.y as number;

    try {
      if (selector) {
        await page.waitForSelector(selector, {
          state: "attached",
          timeout: this.config.timeout,
        });
        await page.locator(selector).first().scrollIntoViewIfNeeded();
        return { success: true, data: { scrolled: "element", selector } };
      } else if (x !== undefined || y !== undefined) {
        await page.evaluate(
          ({ x, y }) => {
            // @ts-ignore - window is available in browser context
            window.scrollTo(x ?? window.scrollX, y ?? window.scrollY);
          },
          { x, y }
        );
        return { success: true, data: { scrolled: "position", x, y } };
      } else {
        return {
          success: false,
          error:
            "Either selector or x/y coordinates are required for scroll step",
        };
      }
    } catch (error: any) {
      return { success: false, error: `Scroll failed: ${error.message}` };
    }
  }

  private async stepHover(step: WorkflowStep, page: Page): Promise<StepResult> {
    const selector = step.config.selector as string;

    if (!selector) {
      return { success: false, error: "Selector is required for hover step" };
    }

    try {
      await page.waitForSelector(selector, {
        state: "visible",
        timeout: this.config.timeout,
      });
      await page.hover(selector);
      return { success: true, data: { hovered: selector } };
    } catch (error: any) {
      return { success: false, error: `Hover failed: ${error.message}` };
    }
  }

  private async stepPressKey(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    const key = step.config.key as string;
    const selector = step.config.selector as string;

    if (!key) {
      return { success: false, error: "Key is required for press_key step" };
    }

    try {
      if (selector) {
        await page.waitForSelector(selector, {
          state: "visible",
          timeout: this.config.timeout,
        });
        await page.locator(selector).press(key);
      } else {
        await page.keyboard.press(key);
      }
      return { success: true, data: { pressed: key, selector } };
    } catch (error: any) {
      return { success: false, error: `Press key failed: ${error.message}` };
    }
  }

  private async stepExecuteJs(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    const code = step.config.code as string;

    if (!code) {
      return { success: false, error: "Code is required for execute_js step" };
    }

    try {
      const result = await page.evaluate((code) => {
        const func = new Function(code);
        return func();
      }, code);

      return { success: true, data: result };
    } catch (error: any) {
      return {
        success: false,
        error: `JavaScript execution failed: ${error.message}`,
      };
    }
  }

  private async launchBrowser(): Promise<Browser> {
    const browser = await chromium.launch({
      headless: this.config.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
      ],
    });
    return browser;
  }

  private async cleanup(resources: BrowserResources): Promise<void> {
    try {
      if (resources.page && !resources.page.isClosed()) {
        await resources.page.close();
      }
    } catch (error) {
      console.error("Error closing page:", error);
    }

    try {
      if (resources.context) {
        await resources.context.close();
      }
    } catch (error) {
      console.error("Error closing context:", error);
    }

    try {
      if (resources.browser) {
        this.activeBrowsers.delete(resources.browser);
        await resources.browser.close();
      }
    } catch (error) {
      console.error("Error closing browser:", error);
    }
  }

  private async waitForAvailableSlot(): Promise<void> {
    while (this.currentConcurrent >= this.maxConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async shutdown(): Promise<void> {
    const browsers = Array.from(this.activeBrowsers);
    await Promise.all(
      browsers.map((browser) => browser.close().catch(() => {}))
    );
    this.activeBrowsers.clear();
    this.currentConcurrent = 0;
  }

  getActiveCount(): number {
    return this.currentConcurrent;
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }
}

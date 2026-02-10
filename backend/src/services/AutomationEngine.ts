import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import type {
  ExecutionContext,
  StepResult,
  BrowserResources,
  EngineConfig,
  ExecutionCallbacks,
  ExecutionProgress,
} from "../types/automation.js";
import type { WorkflowStep } from "../types/database.js";
import { substituteObjectVariables } from "../utils/variableSubstitution.js";
import {
  humanDelay,
  humanType,
  randomMouseMove,
  randomizedViewport,
  STEALTH_LAUNCH_ARGS,
  STEALTH_CONTEXT_OPTIONS,
} from "../utils/humanBehavior.js";

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

      const viewport = randomizedViewport();
      const contextOptions: Record<string, unknown> = {
        viewport,
        ...STEALTH_CONTEXT_OPTIONS,
      };

      // Only set a custom userAgent for local browsers.
      // When using a remote CDP browser (Steel.dev), let it use its own
      // anti-detection fingerprint — overriding it triggers CAPTCHAs.
      if (!process.env.BROWSER_WS_URL) {
        contextOptions.userAgent =
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      }

      resources.context = await resources.browser.newContext(contextOptions);

      resources.page = await resources.context.newPage();
      resources.page.setDefaultTimeout(this.config.timeout);

      for (let i = 0; i < totalSteps; i++) {
        const step = context.definition.steps[i];
        const currentStep = i + 1;

        const substitutedConfig = substituteObjectVariables(
          step.config,
          context.variables
        ) as typeof step.config;

        const substitutedStep = { ...step, config: substitutedConfig };

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

        const result = await this.executeStep(
          substitutedStep,
          resources,
          context,
          callbacks
        );

        if (!result.success) {
          await this.log(
            callbacks,
            "error",
            `Step failed: ${result.error}`,
            step.id
          );
          await callbacks?.onError?.(
            new Error(result.error || "Unknown error"),
            step.id
          );
          throw new Error(`Step ${step.id} failed: ${result.error}`);
        }

        if (result.data !== undefined && (step.type === "extract" || step.type === "extract_to_variable")) {
          context.extractedData[step.id] = result.data;
        }

        await this.log(
          callbacks,
          "info",
          `Step ${currentStep} completed successfully`,
          step.id
        );
        await callbacks?.onStepComplete?.(step.id, result);

        // Human-like pause between steps to reduce bot detection
        if (i < totalSteps - 1 && resources.page) {
          await humanDelay(resources.page, 300, 1200);
        }
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
    context: ExecutionContext,
    callbacks?: ExecutionCallbacks
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
        case "set_variable":
          return await this.stepSetVariable(step, context);
        case "extract_to_variable":
          return await this.stepExtractToVariable(step, page, context);
        case "conditional":
          return await this.stepConditional(step, page, context);
        case "loop":
          return await this.stepLoop(step, page, context, callbacks);
        case "download_file":
          return await this.stepDownloadFile(step, page, context);
        case "drag_drop":
          return await this.stepDragAndDrop(step, page);
        case "set_cookie":
          return await this.stepSetCookie(step, page);
        case "get_cookie":
          return await this.stepGetCookie(step, page, context);
        case "set_localstorage":
          return await this.stepSetLocalStorage(step, page);
        case "get_localstorage":
          return await this.stepGetLocalStorage(step, page, context);
        case "select_dropdown":
          return await this.stepSelectDropdown(step, page);
        case "right_click":
          return await this.stepRightClick(step, page);
        case "double_click":
          return await this.stepDoubleClick(step, page);
        default:
          return { success: false, error: `Unknown step type: ${step.type}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async stepSetVariable(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const variableName = step.config.variableName as string;
      const variableValue = step.config.variableValue;

      if (!variableName) {
        return { success: false, error: "Variable name is required" };
      }

      context.variables[variableName] = variableValue;

      return {
        success: true,
        data: { [variableName]: variableValue },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async stepExtractToVariable(
    step: WorkflowStep,
    page: Page,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const selector = step.config.selector as string;
      const variableName = step.config.variableName as string;
      const attribute = step.config.attribute as string | undefined;

      if (!selector) {
        return { success: false, error: "Selector is required" };
      }

      if (!variableName) {
        return { success: false, error: "Variable name is required" };
      }

      await page.waitForSelector(selector, {
        state: "attached",
        timeout: this.config.timeout,
      });

      let value: string | null;
      if (attribute) {
        value = await page.getAttribute(selector, attribute);
      } else {
        value = await page.textContent(selector);
      }

      const extractedValue = value?.trim() || "";
      context.variables[variableName] = extractedValue;

      return {
        success: true,
        data: { [variableName]: extractedValue },
      };
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
        .catch(() => { console.log("Network idle timeout - continuing"); });
      // Simulate initial human behavior after page load
      await randomMouseMove(page);
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
      // Hover first to simulate mouse movement, then click after a small delay
      await page.hover(selector);
      await humanDelay(page, 80, 250);
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
      // Type character-by-character with random delays to appear human
      await humanType(page, selector, String(value));
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
    const fieldName = step.config.fieldName as string;

    if (!selector) {
      return { success: false, error: "Selector is required for extract step" };
    }

    try {
      if (multiple) {
        // Wait for at least one element to be visible before extracting all
        await page.waitForSelector(selector, {
          state: "visible",
          timeout: this.config.timeout,
        });
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

        return { success: true, data: fieldName ? { [fieldName]: results } : results };
      } else {
        await page.waitForSelector(selector, {
          state: "visible",
          timeout: this.config.timeout,
        });

        if (attribute) {
          const value = await page.getAttribute(selector, attribute);
          return { success: true, data: fieldName ? { [fieldName]: value } : value };
        } else {
          const text = await page.textContent(selector);
          return { success: true, data: fieldName ? { [fieldName]: text?.trim() } : text?.trim() };
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

      return { success: true, screenshot };
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

  private async stepConditional(
    step: WorkflowStep,
    page: Page,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const conditionType = step.config.conditionType as string;
      const selector = step.config.selector as string;
      const text = step.config.text as string;
      const value = step.config.value as string;
      const operator = (step.config.operator as string) || "equals";
      const customScript = step.config.customScript as string;
      const variableName = step.config.variableName as string;

      let result = false;

      switch (conditionType) {
        case "element_exists":
          if (!selector) {
            return {
              success: false,
              error: "Selector required for element_exists",
            };
          }
          const count = await page.locator(selector).count();
          result = count > 0;
          break;

        case "element_visible":
          if (!selector) {
            return {
              success: false,
              error: "Selector required for element_visible",
            };
          }
          try {
            const element = page.locator(selector).first();
            result = await element.isVisible({ timeout: this.config.timeout });
          } catch {
            result = false;
          }
          break;

        case "text_contains":
          if (!selector || !text) {
            return { success: false, error: "Selector and text required" };
          }
          try {
            const element = page.locator(selector).first();
            const content = await element.textContent();
            result = content?.includes(text) || false;
          } catch {
            result = false;
          }
          break;

        case "value_equals":
          if (!variableName || value === undefined) {
            return {
              success: false,
              error: "Variable name and value required",
            };
          }
          const actualValue = String(
            context.variables[variableName] || ""
          ).toLowerCase();
          const expectedValue = String(value).toLowerCase();

          switch (operator) {
            case "equals":
              result = actualValue === expectedValue;
              break;
            case "not_equals":
              result = actualValue !== expectedValue;
              break;
            case "contains":
              result = actualValue.includes(expectedValue);
              break;
            case "not_contains":
              result = !actualValue.includes(expectedValue);
              break;
            case "greater_than":
              result = parseFloat(actualValue) > parseFloat(expectedValue);
              break;
            case "less_than":
              result = parseFloat(actualValue) < parseFloat(expectedValue);
              break;
            default:
              result = false;
          }
          break;

        case "custom_js":
          if (!customScript) {
            return { success: false, error: "Custom script required" };
          }
          try {
            const evalResult = await page.evaluate(
              ({ script, variables }) => {
                const func = new Function("variables", script);
                return func(variables);
              },
              { script: customScript, variables: context.variables }
            );
            result = Boolean(evalResult);
          } catch (error: any) {
            return {
              success: false,
              error: `Script evaluation failed: ${error.message}`,
            };
          }
          break;

        default:
          return {
            success: false,
            error: `Unknown condition type: ${conditionType}`,
          };
      }

      return {
        success: true,
        data: {
          conditionResult: result,
          conditionType,
          evaluatedAt: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Conditional evaluation failed: ${error.message}`,
      };
    }
  }

  private async stepLoop(
    step: WorkflowStep,
    page: Page,
    context: ExecutionContext,
    callbacks?: ExecutionCallbacks
  ): Promise<StepResult> {
    try {
      const loopType = (step.config.loopType as string) || "elements";
      const selector = step.config.selector as string;
      const maxIterations = (step.config.maxIterations as number) || 100;
      const count = step.config.count as number;

      let iterations: unknown[] = [];

      if (loopType === "elements") {
        if (!selector) {
          return {
            success: false,
            error: "Selector required for element loop",
          };
        }

        const elements = await page.locator(selector).all();
        if (elements.length === 0) {
          return {
            success: true,
            data: { iterations: 0, message: "No elements found" },
          };
        }

        iterations = elements.slice(
          0,
          Math.min(elements.length, maxIterations)
        );
      } else if (loopType === "count") {
        if (!count || count < 1) {
          return { success: false, error: "Count must be > 0 for count loop" };
        }

        const actualCount = Math.min(count, maxIterations);
        iterations = Array.from({ length: actualCount }, (_, i) => i);
      } else {
        return { success: false, error: `Unknown loop type: ${loopType}` };
      }

      const results: unknown[] = [];
      const totalIterations = iterations.length;

      for (let i = 0; i < totalIterations; i++) {
        const loopContext = {
          stepId: step.id,
          totalIterations,
          currentIteration: i,
          currentElement: iterations[i],
          shouldBreak: false,
        };

        context.loopContext = loopContext;
        context.variables["loopIndex"] = i;
        context.variables["loopTotal"] = totalIterations;
        context.variables["loopIteration"] = i + 1;

        await this.log(
          callbacks,
          "info",
          `Loop iteration ${i + 1}/${totalIterations}`,
          step.id
        );

        if (loopType === "elements") {
          const element = iterations[i] as any;
          try {
            const text = await element.textContent();
            context.variables["loopElementText"] = text?.trim() || "";

            const innerHTML = await element.innerHTML();
            context.variables["loopElementHTML"] = innerHTML || "";

            results.push({
              index: i,
              text: text?.trim(),
            });
          } catch (error: any) {
            await this.log(
              callbacks,
              "warn",
              `Failed to extract element data: ${error.message}`,
              step.id
            );
          }
        } else {
          results.push({ index: i });
        }

        if (loopContext.shouldBreak) {
          await this.log(
            callbacks,
            "info",
            `Loop break at iteration ${i + 1}`,
            step.id
          );
          break;
        }
      }

      delete context.loopContext;
      delete context.variables["loopIndex"];
      delete context.variables["loopTotal"];
      delete context.variables["loopIteration"];
      delete context.variables["loopElementText"];
      delete context.variables["loopElementHTML"];

      return {
        success: true,
        data: {
          iterations: results.length,
          totalElements: totalIterations,
          results,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Loop execution failed: ${error.message}`,
      };
    }
  }

  private async stepDownloadFile(
    step: WorkflowStep,
    page: Page,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const selector = step.config.selector as string;
      const url = step.config.url as string;
      const waitForDownload = step.config.waitForDownload !== false;
      const triggerMethod = (step.config.triggerMethod as string) || "click";

      if (!selector && !url) {
        return {
          success: false,
          error: "Either selector or URL is required for download",
        };
      }

      let download: any;
      const downloadPromise = page.waitForEvent("download", {
        timeout: this.config.timeout,
      });

      if (triggerMethod === "navigate" && url) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      } else if (selector) {
        await page.click(selector);
      } else if (url) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
      }

      if (waitForDownload) {
        download = await downloadPromise;

        const suggestedFilename = download.suggestedFilename();
        const buffer = await download
          .createReadStream()
          .then(async (stream: any) => {
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
              chunks.push(chunk);
            }
            return Buffer.concat(chunks);
          });

        const { uploadFile, getUserFilePath } = await import(
          "../config/storage.js"
        );
        const storagePath = getUserFilePath(context.userId, suggestedFilename);

        const { error } = await uploadFile(
          "workflow-attachments",
          storagePath,
          buffer,
          this.getMimeType(suggestedFilename)
        );

        if (error) {
          return {
            success: false,
            error: `Failed to upload file: ${error.message}`,
          };
        }

        return {
          success: true,
          data: {
            filename: suggestedFilename,
            size: buffer.length,
            path: storagePath,
            status: "uploaded",
          },
        };
      } else {
        return {
          success: true,
          data: { status: "download_triggered" },
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Download failed: ${error.message}`,
      };
    }
  }

  private getMimeType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      csv: "text/csv",
      json: "application/json",
      txt: "text/plain",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      zip: "application/zip",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
    };
    return mimeTypes[ext || ""] || "application/octet-stream";
  }

  private async stepDragAndDrop(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    try {
      const sourceSelector = step.config.sourceSelector as string;
      const targetSelector = step.config.targetSelector as string;

      if (!sourceSelector || !targetSelector) {
        return {
          success: false,
          error: "Source and target selectors are required",
        };
      }

      await page.waitForSelector(sourceSelector, {
        state: "visible",
        timeout: this.config.timeout,
      });
      await page.waitForSelector(targetSelector, {
        state: "visible",
        timeout: this.config.timeout,
      });

      const source = page.locator(sourceSelector).first();
      const target = page.locator(targetSelector).first();

      await source.dragTo(target);

      return {
        success: true,
        data: { dragged: sourceSelector, droppedOn: targetSelector },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Drag and drop failed: ${error.message}`,
      };
    }
  }

  private async stepSetCookie(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    try {
      const name = step.config.name as string;
      const value = step.config.value as string;
      const domain = step.config.domain as string;
      const path = (step.config.path as string) || "/";

      if (!name || !value) {
        return { success: false, error: "Cookie name and value are required" };
      }

      let cookieDomain = domain;
      if (!cookieDomain) {
        try {
          cookieDomain = new URL(page.url()).hostname;
        } catch {
          cookieDomain = "";
        }
      }

      const context = page.context();
      await context.addCookies([
        {
          name,
          value,
          domain: cookieDomain,
          path,
        },
      ]);

      return {
        success: true,
        data: { cookieName: name, cookieValue: value },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Set cookie failed: ${error.message}`,
      };
    }
  }

  private async stepGetCookie(
    step: WorkflowStep,
    page: Page,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const name = step.config.name as string;
      const variableName = step.config.variableName as string;

      if (!name) {
        return { success: false, error: "Cookie name is required" };
      }

      const browserContext = page.context();
      const cookies = await browserContext.cookies();
      const cookie = cookies.find((c) => c.name === name);

      if (!cookie) {
        return {
          success: false,
          error: `Cookie "${name}" not found`,
        };
      }

      if (variableName) {
        context.variables[variableName] = cookie.value;
      }

      return {
        success: true,
        data: { cookieName: name, cookieValue: cookie.value },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Get cookie failed: ${error.message}`,
      };
    }
  }

  private async stepSetLocalStorage(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    try {
      const key = step.config.key as string;
      const value = step.config.value as string;

      if (!key || value === undefined) {
        return {
          success: false,
          error: "Key and value are required for localStorage",
        };
      }

      await page.evaluate(
        ({ key, value }) => {
          // @ts-ignore - localStorage available in browser
          localStorage.setItem(key, value);
        },
        { key, value }
      );

      return {
        success: true,
        data: { key, value },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Set localStorage failed: ${error.message}`,
      };
    }
  }

  private async stepGetLocalStorage(
    step: WorkflowStep,
    page: Page,
    context: ExecutionContext
  ): Promise<StepResult> {
    try {
      const key = step.config.key as string;
      const variableName = step.config.variableName as string;

      if (!key) {
        return { success: false, error: "Key is required for localStorage" };
      }

      const value = await page.evaluate((key) => {
        // @ts-ignore - localStorage available in browser
        return localStorage.getItem(key);
      }, key);

      if (variableName) {
        context.variables[variableName] = value;
      }

      return {
        success: true,
        data: { key, value },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Get localStorage failed: ${error.message}`,
      };
    }
  }

  private async stepSelectDropdown(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    try {
      const selector = step.config.selector as string;
      const value = step.config.value as string;
      const label = step.config.label as string;
      const index = step.config.index as number;

      if (!selector) {
        return { success: false, error: "Selector is required" };
      }

      await page.waitForSelector(selector, {
        state: "visible",
        timeout: this.config.timeout,
      });

      if (value) {
        await page.selectOption(selector, { value });
      } else if (label) {
        await page.selectOption(selector, { label });
      } else if (index !== undefined) {
        await page.selectOption(selector, { index });
      } else {
        return {
          success: false,
          error: "Value, label, or index is required",
        };
      }

      return {
        success: true,
        data: { selector, value, label, index },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Select dropdown failed: ${error.message}`,
      };
    }
  }

  private async stepRightClick(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    try {
      const selector = step.config.selector as string;

      if (!selector) {
        return { success: false, error: "Selector is required" };
      }

      await page.waitForSelector(selector, {
        state: "visible",
        timeout: this.config.timeout,
      });

      await page.hover(selector);
      await humanDelay(page, 80, 250);
      await page.click(selector, { button: "right" });

      return {
        success: true,
        data: { rightClicked: selector },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Right click failed: ${error.message}`,
      };
    }
  }

  private async stepDoubleClick(
    step: WorkflowStep,
    page: Page
  ): Promise<StepResult> {
    try {
      const selector = step.config.selector as string;

      if (!selector) {
        return { success: false, error: "Selector is required" };
      }

      await page.waitForSelector(selector, {
        state: "visible",
        timeout: this.config.timeout,
      });

      await page.hover(selector);
      await humanDelay(page, 80, 250);
      await page.dblclick(selector);

      return {
        success: true,
        data: { doubleClicked: selector },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Double click failed: ${error.message}`,
      };
    }
  }

  private async launchBrowser(): Promise<Browser> {
    const remoteWsUrl = process.env.BROWSER_WS_URL;

    if (remoteWsUrl) {
      const browser = await chromium.connectOverCDP(remoteWsUrl);
      this.activeBrowsers.add(browser);
      return browser;
    }

    const browser = await chromium.launch({
      headless: this.config.headless,
      args: STEALTH_LAUNCH_ARGS,
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

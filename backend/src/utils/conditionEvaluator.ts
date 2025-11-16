import type { Page } from "playwright";

export interface ConditionConfig {
  type:
    | "element_exists"
    | "element_visible"
    | "text_contains"
    | "value_equals"
    | "custom_js";
  selector?: string;
  text?: string;
  value?: string;
  operator?:
    | "equals"
    | "not_equals"
    | "contains"
    | "not_contains"
    | "greater_than"
    | "less_than";
  customScript?: string;
}

export async function evaluateCondition(
  config: ConditionConfig,
  page: Page,
  variables: Record<string, unknown>
): Promise<boolean> {
  try {
    switch (config.type) {
      case "element_exists":
        return await checkElementExists(page, config.selector!);

      case "element_visible":
        return await checkElementVisible(page, config.selector!);

      case "text_contains":
        return await checkTextContains(page, config.selector!, config.text!);

      case "value_equals":
        return await checkValueEquals(
          config.value!,
          variables[config.selector || ""] as string,
          config.operator || "equals"
        );

      case "custom_js":
        return await evaluateCustomScript(
          page,
          config.customScript!,
          variables
        );

      default:
        return false;
    }
  } catch (error) {
    console.error("Condition evaluation error:", error);
    return false;
  }
}

async function checkElementExists(
  page: Page,
  selector: string
): Promise<boolean> {
  try {
    const count = await page.locator(selector).count();
    return count > 0;
  } catch {
    return false;
  }
}

async function checkElementVisible(
  page: Page,
  selector: string
): Promise<boolean> {
  try {
    const element = page.locator(selector).first();
    return await element.isVisible({ timeout: 1000 });
  } catch {
    return false;
  }
}

async function checkTextContains(
  page: Page,
  selector: string,
  text: string
): Promise<boolean> {
  try {
    const element = page.locator(selector).first();
    const content = await element.textContent();
    return content?.includes(text) || false;
  } catch {
    return false;
  }
}

async function checkValueEquals(
  expectedValue: string,
  actualValue: string,
  operator: string
): Promise<boolean> {
  const expected = String(expectedValue).toLowerCase();
  const actual = String(actualValue || "").toLowerCase();

  switch (operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "not_contains":
      return !actual.includes(expected);
    case "greater_than":
      return parseFloat(actual) > parseFloat(expected);
    case "less_than":
      return parseFloat(actual) < parseFloat(expected);
    default:
      return false;
  }
}

async function evaluateCustomScript(
  page: Page,
  script: string,
  variables: Record<string, unknown>
): Promise<boolean> {
  try {
    const result = await page.evaluate(
      ({ script, variables }) => {
        const func = new Function("variables", script);
        return func(variables);
      },
      { script, variables }
    );
    return Boolean(result);
  } catch {
    return false;
  }
}

export function parseConditionFromConfig(
  config: Record<string, unknown>
): ConditionConfig {
  return {
    type: (config.conditionType as any) || "element_exists",
    selector: config.selector as string,
    text: config.text as string,
    value: config.value as string,
    operator: (config.operator as any) || "equals",
    customScript: config.customScript as string,
  };
}

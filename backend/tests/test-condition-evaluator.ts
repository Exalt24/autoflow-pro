// LIFESPAN: permanent
// Unit tests for evaluateCondition (backend/src/utils/conditionEvaluator.ts) against a fake Page, no browser and no env files.
// The zero and false cases come from a GitHub Copilot CLI review of this file, see docs/test-runs/2026-11-27-copilot-cli-review.txt.
// Run: npm run test:condition
import { evaluateCondition, type ConditionConfig } from "../src/utils/conditionEvaluator.js";
import type { Page } from "playwright-core";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

type FakeElement = { visible?: boolean; text?: string | null };

function fakePage(elementsBySelector: Record<string, FakeElement[]> = {}): Page {
  return {
    locator(selector: string) {
      const elements = elementsBySelector[selector] ?? [];
      return {
        count: async () => elements.length,
        first() {
          const element = elements[0];
          return {
            isVisible: async () => element?.visible ?? false,
            textContent: async () => element?.text ?? null,
          };
        },
      };
    },
    // The real page runs the callback in the browser; here it runs in Node.
    evaluate: async (callback: (argument: unknown) => unknown, argument: unknown) => callback(argument),
  } as unknown as Page;
}

const valueCondition = (operator: ConditionConfig["operator"], value: string): ConditionConfig => ({
  type: "value_equals",
  selector: "v",
  value,
  operator,
});

const page = fakePage({
  ".present": [{ visible: true, text: "Hello, world" }],
  ".hidden": [{ visible: false, text: "Hidden text" }],
});

// Element conditions
check("element_exists finds a present element", (await evaluateCondition({ type: "element_exists", selector: ".present" }, page, {})) === true);
check("element_exists is false for a missing element", (await evaluateCondition({ type: "element_exists", selector: ".missing" }, page, {})) === false);
check("element_visible is true for a visible element", (await evaluateCondition({ type: "element_visible", selector: ".present" }, page, {})) === true);
check("element_visible is false for a hidden element", (await evaluateCondition({ type: "element_visible", selector: ".hidden" }, page, {})) === false);
check("text_contains finds text", (await evaluateCondition({ type: "text_contains", selector: ".present", text: "world" }, page, {})) === true);
check("text_contains is false when the text is absent", (await evaluateCondition({ type: "text_contains", selector: ".present", text: "missing" }, page, {})) === false);

// String and numeric operators on ordinary values
check("equals ignores case", (await evaluateCondition({ type: "value_equals", selector: "name", value: "ALICE", operator: "equals" }, page, { name: "alice" })) === true);
check("contains matches a substring", (await evaluateCondition({ type: "value_equals", selector: "name", value: "ali", operator: "contains" }, page, { name: "Alice" })) === true);
check("greater_than compares numbers", (await evaluateCondition({ type: "value_equals", selector: "score", value: "10", operator: "greater_than" }, page, { score: 12 })) === true);

// Falsy values that are real values: these were turned into an empty string by `actualValue || ""`
check("a variable holding 0 equals \"0\"", (await evaluateCondition(valueCondition("equals", "0"), page, { v: 0 })) === true);
check("a variable holding 0 does not equal \"\"", (await evaluateCondition(valueCondition("equals", ""), page, { v: 0 })) === false);
check("a variable holding 0 is not_equals \"5\"", (await evaluateCondition(valueCondition("not_equals", "5"), page, { v: 0 })) === true);
check("a variable holding 0 is less_than \"1\"", (await evaluateCondition(valueCondition("less_than", "1"), page, { v: 0 })) === true);
check("a variable holding 0 is greater_than \"-1\"", (await evaluateCondition(valueCondition("greater_than", "-1"), page, { v: 0 })) === true);
check("a variable holding false equals \"false\"", (await evaluateCondition(valueCondition("equals", "false"), page, { v: false })) === true);
check("a variable holding false does not equal \"\"", (await evaluateCondition(valueCondition("equals", ""), page, { v: false })) === false);
check("a variable holding 0n equals \"0\"", (await evaluateCondition(valueCondition("equals", "0"), page, { v: 0n })) === true);

// Controls: null, undefined and an empty string still read as an empty string
check("a null variable equals \"\"", (await evaluateCondition(valueCondition("equals", ""), page, { v: null })) === true);
check("an undefined variable equals \"\"", (await evaluateCondition(valueCondition("equals", ""), page, { v: undefined })) === true);
check("a missing variable equals \"\"", (await evaluateCondition(valueCondition("equals", ""), page, {})) === true);
check("a null variable does not equal \"0\"", (await evaluateCondition(valueCondition("equals", "0"), page, { v: null })) === false);
check("a missing variable does not equal \"false\"", (await evaluateCondition(valueCondition("equals", "false"), page, {})) === false);
check("an empty string variable equals \"\"", (await evaluateCondition(valueCondition("equals", ""), page, { v: "" })) === true);

// Custom script
check("custom_js reads the variables", (await evaluateCondition({ type: "custom_js", customScript: "return variables.total > 5;" }, page, { total: 6 })) === true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

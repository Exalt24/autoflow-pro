import validator from "validator";

export function isValidEmail(email: string): boolean {
  return validator.isEmail(email);
}

export function isValidURL(url: string): boolean {
  return validator.isURL(url, {
    protocols: ["http", "https"],
    require_protocol: true,
  });
}

export function isValidUUID(id: string): boolean {
  return validator.isUUID(id, 4);
}

export function isValidCronExpression(cron: string): boolean {
  const cronRegex =
    /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
  return cronRegex.test(cron);
}

export function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeString(str: string): string {
  return validator.escape(str);
}

export function isValidStepType(type: string): boolean {
  const validTypes = [
    "navigate",
    "click",
    "fill",
    "extract",
    "wait",
    "screenshot",
    "scroll",
    "hover",
    "press_key",
    "execute_js",
    "conditional",
    "loop",
    "set_variable",
    "extract_to_variable",
    "download_file",
    "drag_drop",
    "set_cookie",
    "get_cookie",
    "set_localstorage",
    "get_localstorage",
    "select_dropdown",
    "right_click",
    "double_click",
  ];
  return validTypes.includes(type);
}

export function isValidWorkflowStatus(status: string): boolean {
  return ["draft", "active", "archived"].includes(status);
}

export function isValidExecutionStatus(status: string): boolean {
  return ["queued", "running", "completed", "failed"].includes(status);
}

export function isValidRetentionDays(days: number): boolean {
  return [7, 30, 90].includes(days);
}

export function validatePagination(
  page?: number,
  limit?: number
): { page: number; limit: number } {
  const validatedPage = Math.max(1, page || 1);
  const validatedLimit = Math.min(100, Math.max(1, limit || 10));
  return { page: validatedPage, limit: validatedLimit };
}

export function isValidSelector(selector: string): boolean {
  if (!selector || typeof selector !== "string") return false;
  if (selector.length > 500) return false;

  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
  ];

  return !dangerousPatterns.some((pattern) => pattern.test(selector));
}

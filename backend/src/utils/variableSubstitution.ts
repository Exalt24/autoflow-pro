export function substituteVariables(
  value: string | number | boolean | object | null | undefined,
  variables: Record<string, unknown>
): string | number | boolean | object | null | undefined {
  if (typeof value !== "string") return value;

  const regex = /\$\{([^}]+)\}/g;
  let result = value;
  let match;

  while ((match = regex.exec(value)) !== null) {
    const varName = match[1].trim();
    const varValue = getNestedValue(variables, varName);

    if (varValue !== undefined) {
      const stringValue =
        typeof varValue === "object"
          ? JSON.stringify(varValue)
          : String(varValue);
      result = result.replace(match[0], stringValue);
    }
  }

  return result;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: any = obj;

  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }

  return current;
}

export function substituteObjectVariables(
  obj: Record<string, unknown>,
  variables: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = substituteVariables(value, variables);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string" ? substituteVariables(item, variables) : item
      );
    } else if (value && typeof value === "object") {
      result[key] = substituteObjectVariables(
        value as Record<string, unknown>,
        variables
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function extractVariableNames(value: string): string[] {
  const regex = /\$\{([^}]+)\}/g;
  const names: string[] = [];
  let match;

  while ((match = regex.exec(value)) !== null) {
    names.push(match[1].trim());
  }

  return names;
}

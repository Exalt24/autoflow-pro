import { FastifyRequest, FastifyReply } from "fastify";
import validator from "validator";

function sanitizeValue(value: any): any {
  if (typeof value === "string") {
    return validator.escape(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeValue(val);
    }
    return sanitized;
  }
  return value;
}

export async function sanitizeRequest(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (request.body && typeof request.body === "object") {
    request.body = sanitizeValue(request.body);
  }

  if (request.query && typeof request.query === "object") {
    request.query = sanitizeValue(request.query);
  }
}

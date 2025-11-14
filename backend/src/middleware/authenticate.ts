import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyToken, type AuthUser } from "../config/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    reply.code(401).send({ error: "Missing authorization header" });
    return;
  }

  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    reply.code(401).send({ error: "Invalid authorization header" });
    return;
  }

  const user = await verifyToken(token);

  if (!user) {
    reply.code(401).send({ error: "Invalid or expired token" });
    return;
  }

  request.user = user;
}

export async function optionalAuthenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return;
  }

  const token = authHeader.replace("Bearer ", "");

  if (token) {
    const user = await verifyToken(token);
    if (user) {
      request.user = user;
    }
  }
}

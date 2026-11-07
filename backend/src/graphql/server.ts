// The GraphQL server: graphql-yoga mounted on Fastify.
// Why Yoga and not Apollo Server: it is built on web standard Request/Response, has a ready Fastify handler and plain
// plugin hooks (used here for the depth limit), and is one small package; Apollo Server would need its Fastify
// integration package and a separate plugin API for the same result.
import Fastify, { type FastifyInstance } from "fastify";
import { createSchema, createYoga, type Plugin } from "graphql-yoga";
import type { RunLauncher } from "../temporal/client.js";
import { createContext, type GraphQLContext } from "./context.js";
import { depthLimitRule } from "./depthLimit.js";
import { resolvers } from "./resolvers.js";
import type { RunStore } from "./store.js";
import { typeDefs } from "./typeDefs.js";

export const DEFAULT_MAX_DEPTH = 6;

export interface ServerOptions {
  store: RunStore;
  launcher: RunLauncher;
  maxDepth?: number;
}

export function buildSchema() {
  return createSchema<GraphQLContext>({ typeDefs, resolvers: resolvers as never });
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const depthPlugin: Plugin = {
    onValidate({ addValidationRule }) {
      addValidationRule(depthLimitRule(opts.maxDepth ?? DEFAULT_MAX_DEPTH));
    },
  };
  const yoga = createYoga<object, GraphQLContext>({
    schema: buildSchema(),
    graphqlEndpoint: "/graphql",
    landingPage: false,
    logging: false,
    // An error that is not a GraphQLError is a bug: the client sees "Unexpected error." and no stack.
    maskedErrors: true,
    context: () => createContext(opts.store, opts.launcher),
    plugins: [depthPlugin],
  });

  app.get("/health", async () => ({ status: "ok", service: "autoflow-graphql" }));

  app.route({
    url: yoga.graphqlEndpoint,
    method: ["GET", "POST", "OPTIONS"],
    handler: async (req, reply) => {
      const response = await yoga.handleNodeRequestAndResponse(req, reply);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.status(response.status);
      reply.send(response.body);
      return reply;
    },
  });

  return app;
}

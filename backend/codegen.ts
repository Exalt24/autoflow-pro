import type { CodegenConfig } from "@graphql-codegen/cli";

// Types for the resolvers come from the committed schema snapshot. Run: npm run graphql:codegen
const config: CodegenConfig = {
  schema: "src/graphql/schema.graphql",
  generates: {
    "src/graphql/generated/types.ts": {
      plugins: ["typescript", "typescript-resolvers"],
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        scalars: { DateTime: "string" },
        contextType: "../context.js#GraphQLContext",
        mappers: {
          Workflow: "../store.js#WorkflowModel",
          Run: "../store.js#RunModel",
        },
        // union members are plain objects tagged with __typename by the resolvers
        resolverTypeWrapperSignature: "Promise<T> | T",
      },
    },
  },
};

export default config;

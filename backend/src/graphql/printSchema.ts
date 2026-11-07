// Writes the committed schema snapshot: npm run graphql:schema
// test-graphql.ts fails when the snapshot and typeDefs.ts disagree, so a schema change cannot land without its diff.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSchema, printSchema } from "graphql";
import { typeDefs } from "./typeDefs.js";

export const SNAPSHOT_PATH = fileURLToPath(new URL("./schema.graphql", import.meta.url));

export const currentSchemaSdl = (): string => `${printSchema(buildSchema(typeDefs))}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(SNAPSHOT_PATH, currentSchemaSdl());
  console.log(`wrote ${SNAPSHOT_PATH}`);
}

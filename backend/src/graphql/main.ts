// Entry point for the GraphQL server: node dist/src/graphql/main.js
// It keeps runs in memory (no Supabase), starts a Temporal worker in the same process (so the activities can update the
// run store the API reads), and serves GraphQL on GRAPHQL_PORT. Needs a Temporal server at TEMPORAL_ADDRESS.
// GRAPHQL_SEED=0 turns off the four demo workflows.
import { createActivities, DryRunExecutor, FileRunArchive } from "../temporal/activities.js";
import { TemporalRunLauncher } from "../temporal/client.js";
import { createRunWorker } from "../temporal/worker.js";
import { TASK_QUEUE } from "../temporal/types.js";
import { buildServer } from "./server.js";
import { MemoryRunStore } from "./store.js";

async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE;
  const port = Number(process.env.GRAPHQL_PORT ?? 4000);
  const archiveDir = process.env.TEMPORAL_ARCHIVE_DIR ?? "./run-archive";

  const store = new MemoryRunStore();
  const activities = createActivities({ executor: new DryRunExecutor(), archive: new FileRunArchive(archiveDir), recorder: store });
  const { worker, connection } = await createRunWorker({ address, namespace, taskQueue, activities });
  const launcher = await TemporalRunLauncher.connect(address, namespace, taskQueue);

  if (process.env.GRAPHQL_SEED !== "0") {
    const seed = (name: string, description: string, steps: Array<[string, string]>) =>
      store.createWorkflow({ name, description, steps: steps.map(([id, type]) => ({ id, type })) });
    await seed("Quick check", "Three steps that all work.", [["open", "navigate"], ["read", "extract"], ["shot", "screenshot"]]);
    await seed("Flaky page", "The read step fails twice on purpose, so Temporal retries it.", [["open", "navigate"], ["flaky-read", "extract"]]);
    await seed("Slow job", "A 20 second wait step, to try the cancel mutation.", [["open", "navigate"], ["slow-wait", "wait"], ["done", "screenshot"]]);
    await seed("Broken page", "The click step always fails, so the retries run out.", [["open", "navigate"], ["broken-click", "click"]]);
  }

  const app = await buildServer({ store, launcher });
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`graphql up: http://127.0.0.1:${port}/graphql  temporal=${address} namespace=${namespace} taskQueue=${taskQueue}`);

  const workerDone = worker.run();
  const stop = async () => {
    worker.shutdown();
    await app.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await workerDone;
  launcher.close();
  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

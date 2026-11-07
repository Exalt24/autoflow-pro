// Entry point for the Temporal worker: node dist/src/temporal/main.js
// Needs a Temporal server (for local work: `temporal server start-dev`). It does not load the API's Supabase settings.
// The step executor is the dry-run one (no browser); the archive writes JSON files under TEMPORAL_ARCHIVE_DIR.
import { createActivities, DryRunExecutor, FileRunArchive } from "./activities.js";
import { createRunWorker } from "./worker.js";
import { TASK_QUEUE } from "./types.js";

async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? TASK_QUEUE;
  const archiveDir = process.env.TEMPORAL_ARCHIVE_DIR ?? "./run-archive";

  const activities = createActivities({ executor: new DryRunExecutor(), archive: new FileRunArchive(archiveDir) });
  const { worker, connection } = await createRunWorker({ address, namespace, taskQueue, activities });
  console.log(`temporal worker up: ${address} namespace=${namespace} taskQueue=${taskQueue} archive=${archiveDir}`);

  const stop = () => worker.shutdown();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await worker.run();
  await connection.close();
  console.log("temporal worker stopped");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Per request context: the store, the Temporal launcher and the DataLoaders. Loaders are created per request so their
// cache never leaks one request's data into another.
import DataLoader from "dataloader";
import type { RunLauncher } from "../temporal/client.js";
import type { RunModel, RunStore, WorkflowModel } from "./store.js";

export interface Loaders {
  workflowById: DataLoader<string, WorkflowModel | null>;
  runsByWorkflowId: DataLoader<string, RunModel[]>;
}

export interface GraphQLContext {
  store: RunStore;
  launcher: RunLauncher;
  loaders: Loaders;
  /** There is no authentication in this API: every request is this one user. */
  userId: string;
}

export const LOCAL_USER = "local-user";

export function createLoaders(store: RunStore): Loaders {
  return {
    // One store call for every workflow asked for during a tick, however many runs asked.
    workflowById: new DataLoader((ids) => store.getWorkflowsByIds(ids)),
    runsByWorkflowId: new DataLoader((ids) => store.runsForWorkflows(ids)),
  };
}

export function createContext(store: RunStore, launcher: RunLauncher): GraphQLContext {
  return { store, launcher, loaders: createLoaders(store), userId: LOCAL_USER };
}

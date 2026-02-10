import { supabase } from "../config/supabase.js";
import { cacheService } from "../config/cache.js";
import type { Database } from "../types/database.js";

type WorkflowRow = Database["public"]["Tables"]["workflows"]["Row"];
type WorkflowInsert = Database["public"]["Tables"]["workflows"]["Insert"];
type WorkflowUpdate = Database["public"]["Tables"]["workflows"]["Update"];

interface CreateWorkflowInput {
  userId: string;
  name: string;
  description?: string;
  definition: unknown;
  status?: "draft" | "active" | "archived";
}

interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  definition?: unknown;
  status?: "draft" | "active" | "archived";
}

interface ListWorkflowsOptions {
  userId: string;
  status?: "draft" | "active" | "archived";
  page?: number;
  limit?: number;
  search?: string;
}

class WorkflowService {
  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowRow> {
    this.validateWorkflowDefinition(input.definition);

    const workflowData: WorkflowInsert = {
      user_id: input.userId,
      name: input.name,
      description: input.description || null,
      definition: input.definition as any,
      status: input.status || "draft",
    };

    const { data, error } = await supabase
      .from("workflows")
      .insert(workflowData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create workflow: ${error.message}`);
    }

    await this.updateUserWorkflowCount(input.userId);
    await this.invalidateAnalyticsCache(input.userId);
    console.log(`✓ Created workflow ${data.id} for user ${input.userId}`);

    return data;
  }

  async getWorkflowById(
    workflowId: string,
    userId: string
  ): Promise<WorkflowRow | null> {
    const { data, error } = await supabase
      .from("workflows")
      .select("*")
      .eq("id", workflowId)
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return null;
      }
      throw new Error(`Failed to get workflow: ${error.message}`);
    }

    return data;
  }

  async listWorkflows(options: ListWorkflowsOptions): Promise<{
    workflows: WorkflowRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const offset = (page - 1) * limit;

    let query = supabase
      .from("workflows")
      .select("id, user_id, name, description, status, created_at, updated_at", { count: "exact" })
      .eq("user_id", options.userId);

    if (options.status) {
      query = query.eq("status", options.status);
    }

    if (options.search) {
      query = query.or(
        `name.ilike.%${options.search}%,description.ilike.%${options.search}%`
      );
    }

    query = query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to list workflows: ${error.message}`);
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return {
      workflows: (data || []) as any,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async updateWorkflow(
    workflowId: string,
    userId: string,
    input: UpdateWorkflowInput
  ): Promise<WorkflowRow> {
    if (input.definition) {
      this.validateWorkflowDefinition(input.definition);
    }

    const updateData: WorkflowUpdate = {};

    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined)
      updateData.description = input.description;
    if (input.definition !== undefined)
      updateData.definition = input.definition as any;
    if (input.status !== undefined) updateData.status = input.status;

    const { data, error } = await supabase
      .from("workflows")
      .update(updateData)
      .eq("id", workflowId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update workflow: ${error.message}`);
    }

    await this.invalidateAnalyticsCache(userId);
    console.log(`✓ Updated workflow ${workflowId}`);
    return data;
  }

  async deleteWorkflow(workflowId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from("workflows")
      .delete()
      .eq("id", workflowId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to delete workflow: ${error.message}`);
    }

    await this.updateUserWorkflowCount(userId);
    await this.invalidateAnalyticsCache(userId);
    console.log(`✓ Deleted workflow ${workflowId}`);
  }

  async duplicateWorkflow(
    workflowId: string,
    userId: string
  ): Promise<WorkflowRow> {
    const original = await this.getWorkflowById(workflowId, userId);

    if (!original) {
      throw new Error("Workflow not found");
    }

    return await this.createWorkflow({
      userId,
      name: `${original.name} (Copy)`,
      description: original.description || undefined,
      definition: original.definition,
      status: "draft",
    });
  }

  async updateWorkflowStatus(
    workflowId: string,
    userId: string,
    status: "draft" | "active" | "archived"
  ): Promise<WorkflowRow> {
    return await this.updateWorkflow(workflowId, userId, { status });
  }

  async getUserWorkflowCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from("workflows")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to get workflow count: ${error.message}`);
    }

    return count || 0;
  }

  private validateWorkflowDefinition(definition: unknown): void {
    if (!definition || typeof definition !== "object") {
      throw new Error("Workflow definition must be an object");
    }

    const def = definition as any;

    if (!Array.isArray(def.steps)) {
      throw new Error("Workflow definition must contain a steps array");
    }

    if (def.steps.length === 0) {
      throw new Error("Workflow must contain at least one step");
    }

    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i];

      if (!step.id || typeof step.id !== "string") {
        throw new Error(`Step ${i + 1} must have a string id`);
      }

      if (!step.type || typeof step.type !== "string") {
        throw new Error(`Step ${i + 1} must have a string type`);
      }

      if (!step.config || typeof step.config !== "object") {
        throw new Error(`Step ${i + 1} must have a config object`);
      }
    }
  }

  private async updateUserWorkflowCount(userId: string): Promise<void> {
    const count = await this.getUserWorkflowCount(userId);

    const { error } = await supabase
      .from("usage_quotas")
      .upsert({
        user_id: userId,
        workflows_count: count,
        retention_days: 30,
      })
      .select()
      .single();

    if (error && error.code !== "23505") {
      console.error(`Failed to update workflow count: ${error.message}`);
    }
  }

  private async invalidateAnalyticsCache(userId: string): Promise<void> {
    await Promise.all([
      cacheService.del(`stats:${userId}`),
      cacheService.del(`trends:${userId}`),
      cacheService.del(`top-workflows:${userId}`),
      cacheService.del(`quota:${userId}`),
      cacheService.del(`resources:${userId}`),
    ]);
  }
}

export const workflowService = new WorkflowService();

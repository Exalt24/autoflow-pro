import { FastifyInstance } from "fastify";
import validator from "validator";
import { authenticate } from "../middleware/authenticate.js";
import { workflowService } from "../services/WorkflowService.js";
import { executionService } from "../services/ExecutionService.js";
import { queueService } from "../services/QueueService.js";

export async function workflowRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/workflows",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { page, limit, search, status } = request.query as {
          page?: string;
          limit?: string;
          search?: string;
          status?: string;
        };

        const workflows = await workflowService.listWorkflows({
          userId: request.user!.id,
          page: page ? (parseInt(page) || 1) : 1,
          limit: limit ? (parseInt(limit) || 10) : 10,
          search,
          status: status as "draft" | "active" | "archived",
        });

        return reply.send(workflows);
      } catch (error: any) {
        return reply
          .status(500)
          .send({ error: "Failed to fetch workflows", message: error.message });
      }
    }
  );

  fastify.get(
    "/workflows/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const workflow = await workflowService.getWorkflowById(
          id,
          request.user!.id
        );

        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        return reply.send(workflow);
      } catch (error: any) {
        return reply
          .status(500)
          .send({ error: "Failed to fetch workflow", message: error.message });
      }
    }
  );

  fastify.post(
    "/workflows",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { name, description, definition, status } = request.body as {
          name: string;
          description?: string;
          definition: any;
          status?: "draft" | "active" | "archived";
        };

        if (!name || !definition) {
          return reply.status(400).send({
            error: "Missing required fields",
            message: "Name and definition are required",
          });
        }

        const workflow = await workflowService.createWorkflow({
          userId: request.user!.id,
          name,
          description,
          definition,
          status: status || "draft",
        });

        return reply.status(201).send(workflow);
      } catch (error: any) {
        return reply
          .status(500)
          .send({ error: "Failed to create workflow", message: error.message });
      }
    }
  );

  fastify.put(
    "/workflows/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const { name, description, definition, status } = request.body as {
          name?: string;
          description?: string;
          definition?: any;
          status?: "draft" | "active" | "archived";
        };

        const workflow = await workflowService.updateWorkflow(
          id,
          request.user!.id,
          { name, description, definition, status }
        );

        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        return reply.send(workflow);
      } catch (error: any) {
        return reply
          .status(500)
          .send({ error: "Failed to update workflow", message: error.message });
      }
    }
  );

  fastify.delete(
    "/workflows/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        await workflowService.deleteWorkflow(id, request.user!.id);

        return reply.send({ success: true });
      } catch (error: any) {
        return reply
          .status(500)
          .send({ error: "Failed to delete workflow", message: error.message });
      }
    }
  );

  fastify.post(
    "/workflows/:id/duplicate",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }
        const workflow = await workflowService.duplicateWorkflow(
          id,
          request.user!.id
        );

        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        return reply.status(201).send(workflow);
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to duplicate workflow",
          message: error.message,
        });
      }
    }
  );

  fastify.post(
    "/workflows/:id/execute",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        if (!validator.isUUID(id)) {
          return reply.status(400).send({ error: "Invalid ID format" });
        }

        const workflow = await workflowService.getWorkflowById(
          id,
          request.user!.id
        );

        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        const execution = await executionService.createExecution({
          workflowId: id,
          userId: request.user!.id,
          status: "queued",
        });

        const job = await queueService.addJob({
          workflowId: id,
          userId: request.user!.id,
          executionId: execution.id,
          definition: workflow.definition,
        });

        return reply.status(202).send({
          jobId: job.id,
          executionId: execution.id,
          message: "Workflow execution queued",
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to queue workflow execution",
          message: error.message,
        });
      }
    }
  );
}

"use client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { WorkflowList } from "@/components/workflow/WorkflowList";
import { CreateWorkflowModal } from "@/components/workflow/CreateWorkflowModal";
import { workflowsApi, Workflow } from "@/lib/api";
import { Plus } from "lucide-react";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await workflowsApi.list({ page, limit: 10 });
      setWorkflows(result.workflows);
      setTotal(result.total);
    } catch (error) {
      console.error("Failed to fetch workflows:", error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Workflows</h1>
          <p className="text-gray-600">
            Create and manage your automation workflows
          </p>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-gray-200 animate-pulse rounded-lg"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Workflows</h1>
            <p className="text-gray-600">
              Create and manage your automation workflows
            </p>
          </div>
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Workflow
          </Button>
        </div>
        <WorkflowList
          initialWorkflows={workflows}
          initialTotal={total}
          initialPage={page}
          initialLimit={10}
        />
      </div>
      <CreateWorkflowModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={fetchWorkflows}
      />
    </>
  );
}

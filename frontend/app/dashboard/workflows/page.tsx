"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { WorkflowList } from "@/components/workflow/WorkflowList";
import { CreateWorkflowModal } from "@/components/workflow/CreateWorkflowModal";
import { workflowsApi, Workflow } from "@/lib/api";
import { Plus } from "lucide-react";

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [total, setTotal] = useState(0);
  const [page] = useState(1);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    workflowsApi
      .list({ page, limit: 10 })
      .then((result) => {
        if (cancelled) return;
        setWorkflows(result.workflows);
        setTotal(result.total);
      })
      .catch((error) => {
        if (!cancelled) console.error("Failed to fetch workflows:", error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, reloadToken]);

  // A reload after a change shows the loading state again (the first load starts with it already on).
  const reloadWorkflows = () => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  };

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
        onSuccess={reloadWorkflows}
      />
    </>
  );
}

"use client";

import { useState, useEffect, useCallback, memo } from "react";
import { Workflow, workflowsApi } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { useDebounce } from "@/lib/hooks";
import {
  Play,
  Copy,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Network,
} from "lucide-react";
import { formatDate, getStatusColor } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface WorkflowListProps {
  initialWorkflows: Workflow[];
  initialTotal: number;
  initialPage: number;
  initialLimit: number;
}

export const WorkflowList = memo(function WorkflowList({
  initialWorkflows,
  initialTotal,
  initialPage,
  initialLimit,
}: WorkflowListProps) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState(initialWorkflows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [limit] = useState(initialLimit);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "draft" | "active" | "archived"
  >("all");
  const [loading, setLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [workflowToDelete, setWorkflowToDelete] = useState<Workflow | null>(
    null
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{message: string; type: "success" | "error"} | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const totalPages = Math.ceil(total / limit);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const result = await workflowsApi.list({
        page,
        limit,
        search: debouncedSearch || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
      });
      setWorkflows(result.workflows);
      setTotal(result.total);
    } catch (error) {
      console.error("Failed to fetch workflows:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, debouncedSearch, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleStatusFilter = useCallback((value: string) => {
    setStatusFilter(value as typeof statusFilter);
  }, []);

  const handleExecute = useCallback(async (workflow: Workflow) => {
    setActionLoading(workflow.id);
    try {
      const result = await workflowsApi.execute(workflow.id);
      setToast({message: `Workflow execution started! Execution ID: ${result.executionId}`, type: "success"});
      router.refresh();
    } catch (error) {
      console.error("Failed to execute workflow:", error);
      setToast({message: "Failed to start workflow execution", type: "error"});
    } finally {
      setActionLoading(null);
    }
  }, [router]);

  const handleDuplicate = useCallback(async (workflow: Workflow) => {
    setActionLoading(workflow.id);
    try {
      await workflowsApi.duplicate(workflow.id);
      fetchWorkflows();
    } catch (error) {
      console.error("Failed to duplicate workflow:", error);
      setToast({message: "Failed to duplicate workflow", type: "error"});
    } finally {
      setActionLoading(null);
    }
  }, [fetchWorkflows]);

  const confirmDelete = useCallback((workflow: Workflow) => {
    setWorkflowToDelete(workflow);
    setDeleteModalOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!workflowToDelete) return;

    setActionLoading(workflowToDelete.id);
    try {
      await workflowsApi.delete(workflowToDelete.id);
      setDeleteModalOpen(false);
      setWorkflowToDelete(null);
      fetchWorkflows();
    } catch (error) {
      console.error("Failed to delete workflow:", error);
      setToast({message: "Failed to delete workflow", type: "error"});
    } finally {
      setActionLoading(null);
    }
  }, [workflowToDelete, fetchWorkflows]);

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                placeholder="Search workflows..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 pl-10 pr-4 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            </div>
          </div>

          <select
            title="Filter by Status"
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
            className="h-10 px-3 pr-8 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            <option value="all">All Status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 bg-gray-200 animate-pulse rounded-lg"
              />
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <Card>
            <div className="p-12 text-center">
              <p className="text-gray-500 mb-4">No workflows found</p>
              {(search || statusFilter !== "all") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {workflows.map((workflow) => (
              <Card key={workflow.id}>
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">
                          {workflow.name}
                        </h3>
                        <Badge className={getStatusColor(workflow.status)}>
                          {workflow.status}
                        </Badge>
                      </div>
                      {workflow.description && (
                        <p className="text-gray-600 mb-3">
                          {workflow.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>{workflow.definition.steps.length} steps</span>
                        <span>•</span>
                        <span>Created {formatDate(workflow.created_at)}</span>
                        <span>•</span>
                        <span>Updated {formatDate(workflow.updated_at)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() => handleExecute(workflow)}
                        loading={actionLoading === workflow.id}
                        disabled={workflow.status === "archived"}
                      >
                        <Play className="h-4 w-4 mr-2" />
                        Execute
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          router.push(
                            `/dashboard/workflows/${workflow.id}/builder`
                          )
                        }
                        title="Visual Builder"
                      >
                        <Network className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDuplicate(workflow)}
                        loading={actionLoading === workflow.id}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => confirmDelete(workflow)}
                        loading={actionLoading === workflow.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Showing {(page - 1) * limit + 1} to{" "}
              {Math.min(page * limit, total)} of {total} workflows
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm px-3">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Workflow"
        description="Are you sure you want to delete this workflow? This action cannot be undone."
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              loading={actionLoading !== null}
            >
              Delete
            </Button>
          </div>
        }
      >
        {workflowToDelete && (
          <div className="p-4 bg-gray-50 rounded-md">
            <p className="font-medium">{workflowToDelete.name}</p>
            {workflowToDelete.description && (
              <p className="text-sm text-gray-600 mt-1">
                {workflowToDelete.description}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
});

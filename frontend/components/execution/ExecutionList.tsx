"use client";

import { useState, useEffect, useCallback, memo } from "react";
import { Execution, executionsApi } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Toast } from "@/components/ui/Toast";
import { Trash2, Eye, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { formatDate, formatDuration, getStatusColor } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface ExecutionListProps {
  initialExecutions: Execution[];
  initialTotal: number;
  initialPage: number;
  initialLimit: number;
}

export const ExecutionList = memo(function ExecutionList({
  initialExecutions,
  initialTotal,
  initialPage,
  initialLimit,
}: ExecutionListProps) {
  const router = useRouter();
  const [executions, setExecutions] = useState(initialExecutions);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [limit] = useState(initialLimit);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "queued" | "running" | "completed" | "failed"
  >("all");
  const [loading, setLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [executionToDelete, setExecutionToDelete] = useState<Execution | null>(
    null
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{message: string; type: "success" | "error"} | null>(null);

  const totalPages = Math.ceil(total / limit);

  const fetchExecutions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await executionsApi.list({
        page,
        limit,
        status: statusFilter !== "all" ? statusFilter : undefined,
      });
      setExecutions(result.executions);
      setTotal(result.total);
    } catch (error) {
      console.error("Failed to fetch executions:", error);
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  const handleStatusFilter = useCallback((value: string) => {
    setStatusFilter(value as typeof statusFilter);
  }, []);

  const handleView = useCallback((execution: Execution) => {
    router.push(`/dashboard/executions/${execution.id}`);
  }, [router]);

  const confirmDelete = useCallback((execution: Execution) => {
    setExecutionToDelete(execution);
    setDeleteModalOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!executionToDelete) return;

    setActionLoading(executionToDelete.id);
    try {
      await executionsApi.delete(executionToDelete.id);
      setDeleteModalOpen(false);
      setExecutionToDelete(null);
      fetchExecutions();
    } catch (error) {
      console.error("Failed to delete execution:", error);
      setToast({message: "Failed to delete execution", type: "error"});
    } finally {
      setActionLoading(null);
    }
  }, [executionToDelete, fetchExecutions]);

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Filter className="h-5 w-5 text-gray-400" />
          <select
            title="Filter by Status"
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
            className="h-10 px-3 pr-8 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            <option value="all">All Status</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
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
        ) : executions.length === 0 ? (
          <Card>
            <div className="p-12 text-center">
              <p className="text-gray-500 mb-4">No executions found</p>
              {statusFilter !== "all" && (
                <Button
                  variant="outline"
                  onClick={() => setStatusFilter("all")}
                >
                  Clear Filter
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {executions.map((execution) => (
              <Card key={execution.id}>
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className={getStatusColor(execution.status)}>
                          {execution.status}
                        </Badge>
                        {execution.status === "running" && (
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-sm text-gray-600">
                              In Progress
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>Started {formatDate(execution.started_at)}</span>
                        {execution.duration && (
                          <>
                            <span>•</span>
                            <span>
                              Duration: {formatDuration(execution.duration)}
                            </span>
                          </>
                        )}
                        {execution.logs && execution.logs.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{execution.logs.length} logs</span>
                          </>
                        )}
                      </div>
                      {execution.error_message && (
                        <p className="text-sm text-red-600 mt-2">
                          {execution.error_message}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleView(execution)}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        View
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => confirmDelete(execution)}
                        loading={actionLoading === execution.id}
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
              {Math.min(page * limit, total)} of {total} executions
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
        title="Delete Execution"
        description="Are you sure you want to delete this execution? This action cannot be undone."
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
        {executionToDelete && (
          <div className="p-4 bg-gray-50 rounded-md">
            <p className="font-medium">Execution ID: {executionToDelete.id}</p>
            <p className="text-sm text-gray-600 mt-1">
              Status: {executionToDelete.status} • Started:{" "}
              {formatDate(executionToDelete.started_at)}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
});

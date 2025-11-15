"use client";

import { useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  Trash2,
  Clock,
  Edit,
} from "lucide-react";
import { scheduledJobsApi, workflowsApi, type ScheduledJob } from "@/lib/api";
import { useRouter } from "next/navigation";
import { EditScheduledJobModal } from "./EditScheduledJobModal";

interface ScheduledJobListProps {
  initialJobs: ScheduledJob[];
  initialTotal: number;
  initialPage: number;
  initialLimit: number;
}

export function ScheduledJobList({
  initialJobs,
  initialTotal,
  initialPage,
  initialLimit,
}: ScheduledJobListProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [limit] = useState(initialLimit);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [jobToEdit, setJobToEdit] = useState<ScheduledJob | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [workflowNames, setWorkflowNames] = useState<Record<string, string>>(
    {}
  );

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter]);

  useEffect(() => {
    fetchWorkflowNames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const isActive =
        statusFilter === "active"
          ? true
          : statusFilter === "inactive"
          ? false
          : undefined;

      const data = await scheduledJobsApi.list({
        page,
        limit,
        isActive,
      });
      setJobs(data.scheduledJobs);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch scheduled jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflowNames = async () => {
    const uniqueWorkflowIds = [...new Set(jobs.map((j) => j.workflow_id))];
    const names: Record<string, string> = {};

    await Promise.all(
      uniqueWorkflowIds.map(async (id) => {
        try {
          const workflow = await workflowsApi.getById(id);
          names[id] = workflow.name;
        } catch {
          names[id] = "Unknown Workflow";
        }
      })
    );

    setWorkflowNames(names);
  };

  const handleToggleActive = async (job: ScheduledJob) => {
    setActionLoading(job.id);
    try {
      await scheduledJobsApi.update(job.id, { isActive: !job.is_active });
      await fetchJobs();
      router.refresh();
    } catch (err) {
      alert(
        `Failed to update job: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!jobToDelete) return;

    setActionLoading(jobToDelete);
    try {
      await scheduledJobsApi.delete(jobToDelete);
      setDeleteModalOpen(false);
      setJobToDelete(null);
      await fetchJobs();
      router.refresh();
    } catch (err) {
      alert(
        `Failed to delete job: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setActionLoading(null);
    }
  };

  const formatNextRun = (date: string) => {
    const nextRun = new Date(date);
    const now = new Date();
    const diff = nextRun.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (diff < 0) return "Overdue";
    if (hours < 1) return `in ${minutes}m`;
    if (hours < 24) return `in ${hours}h ${minutes}m`;

    return nextRun.toLocaleDateString();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="h-10 px-3 border border-gray-300 rounded-md"
          aria-label="Filter by status"
        >
          <option value="all">All Jobs</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-gray-200 rounded-lg animate-pulse"
            />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <Clock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-600">No scheduled jobs found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 cursor-pointer"
              onClick={() => router.push(`/dashboard/scheduled-jobs/${job.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">
                      {workflowNames[job.workflow_id] || "Loading..."}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        job.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {job.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 font-mono">
                    {job.cron_schedule}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setJobToEdit(job);
                      setEditModalOpen(true);
                    }}
                    disabled={actionLoading === job.id}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-md disabled:opacity-50"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleActive(job);
                    }}
                    disabled={actionLoading === job.id}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-md disabled:opacity-50"
                    title={job.is_active ? "Pause" : "Resume"}
                  >
                    {job.is_active ? (
                      <Pause className="w-4 h-4" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setJobToDelete(job.id);
                      setDeleteModalOpen(true);
                    }}
                    disabled={actionLoading === job.id}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Next run:</span>
                  <span className="ml-2 font-medium">
                    {formatNextRun(job.next_run_at)}
                  </span>
                </div>
                {job.last_run_at && (
                  <div>
                    <span className="text-gray-600">Last run:</span>
                    <span className="ml-2">
                      {new Date(job.last_run_at).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {editModalOpen && jobToEdit && (
        <EditScheduledJobModal
          open={editModalOpen}
          onClose={() => {
            setEditModalOpen(false);
            setJobToEdit(null);
          }}
          onSuccess={fetchJobs}
          job={jobToEdit}
        />
      )}

      {deleteModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-2">Delete Scheduled Job</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this scheduled job? This action
              cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setJobToDelete(null);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading !== null}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

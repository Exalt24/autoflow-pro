"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Clock, Play, Pause, Edit, Calendar } from "lucide-react";
import {
  scheduledJobsApi,
  workflowsApi,
  type ScheduledJob,
  type Execution,
} from "@/lib/api";
import { NextRunsPreview } from "@/components/scheduled-jobs/NextRunsPreview";
import { EditScheduledJobModal } from "@/components/scheduled-jobs/EditScheduledJobModal";
import { FailureStats } from "@/components/scheduled-jobs/FailureStats";

export default function ScheduledJobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const [job, setJob] = useState<ScheduledJob | null>(null);
  const [workflowName, setWorkflowName] = useState("");
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchJobDetails = useCallback(async () => {
    setLoading(true);
    try {
      const [jobData, historyData] = await Promise.all([
        scheduledJobsApi.getById(jobId),
        scheduledJobsApi.getHistory(jobId, 20),
      ]);

      setJob(jobData);
      setExecutions(historyData.executions);

      const workflow = await workflowsApi.getById(jobData.workflow_id);
      setWorkflowName(workflow.name);
    } catch (err) {
      console.error("Failed to fetch job details:", err);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    fetchJobDetails();
  }, [fetchJobDetails]);

  const handleToggleActive = async () => {
    if (!job) return;

    setActionLoading(true);
    try {
      await scheduledJobsApi.update(job.id, { isActive: !job.is_active });
      await fetchJobDetails();
      router.refresh();
    } catch (err) {
      alert(
        `Failed to update job: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-64 bg-gray-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="p-8">
        <div className="text-center py-12">
          <p className="text-gray-600">Scheduled job not found</p>
          <button
            onClick={() => router.push("/dashboard/scheduled-jobs")}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Back to Scheduled Jobs
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{workflowName}</h1>
            <span
              className={`px-3 py-1 rounded-full text-sm ${
                job.is_active
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {job.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              <Edit className="w-4 h-4" />
              Edit
            </button>
            <button
              onClick={handleToggleActive}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {job.is_active ? (
                <>
                  <Pause className="w-4 h-4" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Resume
                </>
              )}
            </button>
          </div>
        </div>
        <p className="text-gray-600">Scheduled Job Details</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Schedule Information
          </h2>
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-600">Cron Expression:</span>
              <p className="font-mono text-lg">{job.cron_schedule}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Next Run:</span>
              <p className="font-medium">
                {new Date(job.next_run_at).toLocaleString()}
              </p>
            </div>
            {job.last_run_at && (
              <div>
                <span className="text-sm text-gray-600">Last Run:</span>
                <p>{new Date(job.last_run_at).toLocaleString()}</p>
              </div>
            )}
            <div>
              <span className="text-sm text-gray-600">Created:</span>
              <p>{new Date(job.created_at).toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Upcoming Runs
          </h2>
          <NextRunsPreview cronSchedule={job.cron_schedule} />
        </div>
      </div>

      <div className="mb-8">
        <FailureStats jobId={jobId} />
      </div>

      <div className="border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4">Execution History</h2>
        {executions.length === 0 ? (
          <p className="text-gray-600 text-center py-8">
            No executions yet. This job will run at the scheduled time.
          </p>
        ) : (
          <div className="space-y-3">
            {executions.map((execution) => (
              <div
                key={execution.id}
                className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 cursor-pointer"
                onClick={() =>
                  router.push(`/dashboard/executions/${execution.id}`)
                }
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      execution.status === "completed"
                        ? "bg-green-100 text-green-700"
                        : execution.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : execution.status === "running"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {execution.status}
                  </span>
                  <span className="text-sm text-gray-600">
                    {new Date(execution.started_at).toLocaleString()}
                  </span>
                </div>
                {execution.duration && (
                  <p className="text-sm text-gray-600">
                    Duration: {(execution.duration / 1000).toFixed(2)}s
                  </p>
                )}
                {execution.error_message && (
                  <p className="text-sm text-red-600 mt-2">
                    {execution.error_message}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editModalOpen && (
        <EditScheduledJobModal
          open={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          onSuccess={fetchJobDetails}
          job={job}
        />
      )}
    </div>
  );
}

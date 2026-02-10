"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { scheduledJobsApi, workflowsApi, type Workflow } from "@/lib/api";
import { useRouter } from "next/navigation";
import { CronPresetSelector } from "./CronPresetSelector";
import { NextRunsPreview } from "./NextRunsPreview";

interface CreateScheduledJobModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateScheduledJobModal({
  open,
  onClose,
  onSuccess,
}: CreateScheduledJobModalProps) {
  const router = useRouter();
  const [workflowId, setWorkflowId] = useState("");
  const [cronSchedule, setCronSchedule] = useState("0 9 * * *");
  const [isActive, setIsActive] = useState(true);
  const [showCustomCron, setShowCustomCron] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      fetchWorkflows();
    } else {
      setError("");
      setWorkflowId("");
      setCronSchedule("0 9 * * *");
      setIsActive(true);
      setShowCustomCron(false);
      setLoading(false);
    }
  }, [open]);

  const fetchWorkflows = async () => {
    try {
      const data = await workflowsApi.list({ limit: 100, status: "active" });
      setWorkflows(data.workflows);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch workflows"
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await scheduledJobsApi.create({
        workflowId,
        cronSchedule,
        isActive,
      });

      setWorkflowId("");
      setCronSchedule("0 9 * * *");
      setIsActive(true);
      setShowCustomCron(false);
      onSuccess();
      onClose();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create scheduled job"
      );
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Schedule Workflow</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Workflow *</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              required
              className="w-full h-10 px-3 border border-gray-300 rounded-md"
              aria-label="Select workflow"
            >
              <option value="">Select workflow...</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </div>

          <CronPresetSelector
            value={cronSchedule}
            onChange={setCronSchedule}
            onCustom={() => setShowCustomCron(true)}
            showCustom={showCustomCron}
          />

          <NextRunsPreview cronSchedule={cronSchedule} />

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="isActive" className="text-sm">
              Active (start scheduling immediately)
            </label>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

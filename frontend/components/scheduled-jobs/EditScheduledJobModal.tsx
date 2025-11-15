"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { scheduledJobsApi, type ScheduledJob } from "@/lib/api";
import { useRouter } from "next/navigation";
import { CronPresetSelector } from "./CronPresetSelector";
import { NextRunsPreview } from "./NextRunsPreview";

interface EditScheduledJobModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  job: ScheduledJob;
}

export function EditScheduledJobModal({
  open,
  onClose,
  onSuccess,
  job,
}: EditScheduledJobModalProps) {
  const router = useRouter();
  const [cronSchedule, setCronSchedule] = useState(job.cron_schedule);
  const [isActive, setIsActive] = useState(job.is_active);
  const [showCustomCron, setShowCustomCron] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setCronSchedule(job.cron_schedule);
      setIsActive(job.is_active);
      setShowCustomCron(false);
    }
  }, [open, job]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await scheduledJobsApi.update(job.id, {
        cronSchedule,
        isActive,
      });

      onSuccess();
      onClose();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update scheduled job"
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
          <h2 className="text-xl font-semibold">Edit Scheduled Job</h2>
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
              Active
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
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

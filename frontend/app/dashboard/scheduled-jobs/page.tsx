"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { scheduledJobsApi, type ScheduledJob } from "@/lib/api";
import { ScheduledJobList } from "@/components/scheduled-jobs/ScheduledJobList";
import { CreateScheduledJobModal } from "@/components/scheduled-jobs/CreateScheduledJobModal";

export default function ScheduledJobsPage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const data = await scheduledJobsApi.list({ page: 1, limit: 20 });
      setJobs(data.scheduledJobs);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch scheduled jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">Scheduled Jobs</h1>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Schedule Workflow
          </button>
        </div>
        <p className="text-gray-600">
          Automate workflows to run on a schedule using cron expressions
        </p>
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
      ) : (
        <ScheduledJobList
          initialJobs={jobs}
          initialTotal={total}
          initialPage={1}
          initialLimit={20}
        />
      )}

      <CreateScheduledJobModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={fetchJobs}
      />
    </div>
  );
}

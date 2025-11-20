"use client";

import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { ErrorAnalysis } from "@/lib/api";
import { AlertCircle, ExternalLink, Clock } from "lucide-react";

interface ErrorAnalysisTableProps {
  data: ErrorAnalysis[];
  loading: boolean;
}

export default function ErrorAnalysisTable({
  data,
  loading,
}: ErrorAnalysisTableProps) {
  const router = useRouter();

  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Error Analysis</h3>
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Error Analysis</h3>
          <div className="flex flex-col items-center justify-center py-8 text-gray-500">
            <AlertCircle className="h-12 w-12 mb-3 text-gray-400" />
            <p className="text-sm">No errors found</p>
            <p className="text-xs mt-1">
              All executions completed successfully
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Common Errors</h3>
          <p className="text-sm text-gray-500">{data.length} error types</p>
        </div>

        <div className="space-y-3">
          {data.map((error, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg p-4 hover:border-red-300 hover:bg-red-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {error.errorMessage}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-600">
                    <span className="flex items-center gap-1">
                      <span className="font-semibold text-red-600">
                        {error.count}
                      </span>
                      occurrence{error.count !== 1 ? "s" : ""}
                    </span>
                    <span>
                      {error.affectedWorkflows} workflow
                      {error.affectedWorkflows !== 1 ? "s" : ""}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(error.lastOccurred)}
                    </span>
                  </div>
                </div>

                {error.affectedExecutions.length > 0 && (
                  <button
                    onClick={() =>
                      router.push(
                        `/dashboard/executions/${error.affectedExecutions[0]}`
                      )
                    }
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 whitespace-nowrap"
                    title="View latest execution"
                  >
                    View
                    <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {data.length > 0 && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-xs text-blue-900">
              <strong>Tip:</strong> Click &quot;View&quot; to see the full
              execution details and logs for troubleshooting. Common fixes
              include updating selectors, increasing wait times, or handling
              dynamic content.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

"use client";

import { Card } from "@/components/ui/Card";
import { UsageQuota } from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface UsageQuotaCardProps {
  quota: UsageQuota;
  loading?: boolean;
}

const getProgressColor = (percentage: number) => {
  if (percentage >= 90) return "bg-red-500";
  if (percentage >= 75) return "bg-yellow-500";
  return "bg-green-500";
};

const QuotaBar = ({
  label,
  current,
  limit,
  percentage,
}: {
  label: string;
  current: number | string;
  limit: number | string;
  percentage: number;
}) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <span className="text-sm text-gray-600">
        {current} / {limit}
      </span>
    </div>
    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
      <div
        className={`h-full ${getProgressColor(percentage)} transition-all`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
    {percentage >= 80 && (
      <div className="flex items-center gap-1 mt-1 text-xs text-yellow-700">
        <AlertTriangle className="h-3 w-3" />
        <span>Approaching limit</span>
      </div>
    )}
  </div>
);

export function UsageQuotaCard({
  quota,
  loading = false,
}: UsageQuotaCardProps) {
  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Usage Quotas</h3>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-200 animate-pulse rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  const executionPercentage =
    (quota.executionsCount / quota.executionsLimit) * 100;
  const workflowPercentage = (quota.workflowsCount / 10) * 100;
  const storagePercentage = (quota.storageUsed / (1024 * 1024 * 1024)) * 100;

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">Usage Quotas</h3>
        <div className="space-y-6">
          <QuotaBar
            label="Workflows"
            current={quota.workflowsCount}
            limit={10}
            percentage={workflowPercentage}
          />
          <QuotaBar
            label="Executions (This Month)"
            current={quota.executionsCount}
            limit={quota.executionsLimit}
            percentage={executionPercentage}
          />
          <QuotaBar
            label="Storage Used"
            current={formatBytes(quota.storageUsed)}
            limit="1 GB"
            percentage={storagePercentage}
          />
        </div>

        {(executionPercentage >= 90 ||
          workflowPercentage >= 90 ||
          storagePercentage >= 90) && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-sm text-yellow-800">
              You&apos;re approaching your usage limits. Consider upgrading for
              more capacity.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

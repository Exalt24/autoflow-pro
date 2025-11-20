"use client";

import { Card } from "@/components/ui/Card";
import { Server, Database, HardDrive, Activity } from "lucide-react";

interface ResourceUsage {
  render: {
    hoursUsed: number;
    hoursLimit: number;
    percentageUsed: number;
  };
  redis: {
    commandsUsed: number;
    commandsLimit: number;
    percentageUsed: number;
    commandsPerMinute: number;
  };
  supabase: {
    bandwidthUsed: number;
    bandwidthLimit: number;
    percentageUsed: number;
  };
  r2: {
    storageUsed: number;
    storageLimit: number;
    percentageUsed: number;
  };
}

interface ResourceUsageCardProps {
  resources: ResourceUsage | null;
  loading: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function getProgressColor(percentage: number): string {
  if (percentage >= 90) return "bg-red-500";
  if (percentage >= 75) return "bg-yellow-500";
  return "bg-green-500";
}

export default function ResourceUsageCard({
  resources,
  loading,
}: ResourceUsageCardProps) {
  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Resource Usage</h3>
          <div className="space-y-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-200 animate-pulse rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  if (!resources) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Resource Usage</h3>
          <p className="text-gray-500 text-sm">No resource data available</p>
        </div>
      </Card>
    );
  }

  const metrics = [
    {
      icon: Server,
      label: "Render Hours",
      current: `${resources.render.hoursUsed.toFixed(1)}h`,
      limit: `${resources.render.hoursLimit}h`,
      percentage: resources.render.percentageUsed,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      icon: Activity,
      label: "Redis Commands",
      current: resources.redis.commandsUsed.toLocaleString(),
      limit: resources.redis.commandsLimit.toLocaleString(),
      percentage: resources.redis.percentageUsed,
      color: "text-red-600",
      bg: "bg-red-50",
      extra: `${resources.redis.commandsPerMinute}/min`,
    },
    {
      icon: Database,
      label: "Supabase Bandwidth",
      current: formatBytes(resources.supabase.bandwidthUsed),
      limit: formatBytes(resources.supabase.bandwidthLimit),
      percentage: resources.supabase.percentageUsed,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      icon: HardDrive,
      label: "R2 Storage",
      current: formatBytes(resources.r2.storageUsed),
      limit: formatBytes(resources.r2.storageLimit),
      percentage: resources.r2.percentageUsed,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
  ];

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">Resource Usage</h3>
        <div className="space-y-6">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${metric.bg}`}>
                      <Icon className={`h-4 w-4 ${metric.color}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{metric.label}</p>
                      {metric.extra && (
                        <p className="text-xs text-gray-500">{metric.extra}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {metric.current} / {metric.limit}
                    </p>
                    <p className="text-xs text-gray-500">
                      {metric.percentage.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`${getProgressColor(
                      metric.percentage
                    )} h-2 rounded-full transition-all`}
                    style={{
                      width: `${Math.min(metric.percentage, 100)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {(resources.render.percentageUsed > 80 ||
          resources.redis.percentageUsed > 80 ||
          resources.supabase.percentageUsed > 80 ||
          resources.r2.percentageUsed > 80) && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
            <p className="text-sm font-medium text-orange-900">
              Resource Limit Warning
            </p>
            <p className="text-sm text-orange-700 mt-1">
              You&apos;re approaching limits on one or more resources. Monitor
              usage closely to avoid service interruptions.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

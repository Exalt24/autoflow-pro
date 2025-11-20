"use client";

import { Card } from "@/components/ui/Card";
import { Archive, Database, HardDrive, Clock } from "lucide-react";
import { ArchivalStats as ArchivalStatsType } from "@/lib/api";

interface ArchivalStatsProps {
  stats: ArchivalStatsType | null;
  loading: boolean;
}

export default function ArchivalStats({ stats, loading }: ArchivalStatsProps) {
  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Data Archival</h3>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 bg-gray-200 animate-pulse rounded" />
            ))}
          </div>
        </div>
      </Card>
    );
  }

  const metrics = [
    {
      label: "Total Executions",
      value: stats?.totalExecutions || 0,
      icon: Database,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Active",
      value: stats?.activeExecutions || 0,
      icon: HardDrive,
      color: "text-green-600",
      bg: "bg-green-50",
    },
    {
      label: "Archived",
      value: stats?.archivedExecutions || 0,
      icon: Archive,
      color: "text-purple-600",
      bg: "bg-purple-50",
    },
    {
      label: "Eligible for Archival",
      value: stats?.eligibleForArchival || 0,
      icon: Clock,
      color: "text-orange-600",
      bg: "bg-orange-50",
    },
  ];

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">Data Archival</h3>
        <div className="grid grid-cols-2 gap-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${metric.bg}`}>
                  <Icon className={`h-5 w-5 ${metric.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{metric.value}</p>
                  <p className="text-sm text-gray-600">{metric.label}</p>
                </div>
              </div>
            );
          })}
        </div>
        {stats && stats.eligibleForArchival > 0 && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
            <p className="text-sm text-orange-900">
              <strong>{stats.eligibleForArchival}</strong> executions older than
              30 days are ready for archival to free up database storage.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

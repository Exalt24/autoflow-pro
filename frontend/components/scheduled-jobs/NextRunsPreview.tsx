"use client";

import { useMemo } from "react";
import { Clock } from "lucide-react";

interface NextRunsPreviewProps {
  cronSchedule: string;
}

function parseCronField(field: string, currentValue: number): boolean {
  // Handle wildcard
  if (field === "*") return true;

  // Split by comma for lists (e.g., "1,15,30")
  const parts = field.split(",");

  for (const part of parts) {
    // Handle step values (e.g., "*/5" or "1-10/2")
    if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;

      if (rangeStr === "*") {
        if (currentValue % step === 0) return true;
      } else if (rangeStr.includes("-")) {
        const [startStr, endStr] = rangeStr.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (
          currentValue >= start &&
          currentValue <= end &&
          (currentValue - start) % step === 0
        ) {
          return true;
        }
      }
      continue;
    }

    // Handle ranges (e.g., "1-5")
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (currentValue >= start && currentValue <= end) return true;
      continue;
    }

    // Handle exact values
    if (parseInt(part, 10) === currentValue) return true;
  }

  return false;
}

function getNextRuns(cronSchedule: string, count: number = 5): Date[] {
  const parts = cronSchedule.trim().split(/\s+/);
  if (parts.length !== 5) return [];

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const runs: Date[] = [];
  const now = new Date();
  let current = new Date(now);
  // Zero out seconds and milliseconds
  current.setSeconds(0, 0);

  const maxIterations = 525600; // 1 year of minutes

  for (let i = 0; i < maxIterations && runs.length < count; i++) {
    current = new Date(current.getTime() + 60000);

    const m = current.getMinutes();
    const h = current.getHours();
    const d = current.getDate();
    const mo = current.getMonth() + 1;
    const dw = current.getDay();

    if (
      parseCronField(minute, m) &&
      parseCronField(hour, h) &&
      parseCronField(dayOfMonth, d) &&
      parseCronField(month, mo) &&
      parseCronField(dayOfWeek, dw)
    ) {
      runs.push(new Date(current));
    }
  }

  return runs;
}

export function NextRunsPreview({ cronSchedule }: NextRunsPreviewProps) {
  const nextRuns = useMemo(() => getNextRuns(cronSchedule, 5), [cronSchedule]);

  if (nextRuns.length === 0) {
    return (
      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
        <p className="text-sm text-yellow-800">
          Unable to calculate next run times. Please check your cron expression.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-md">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-gray-600" />
        <h4 className="text-sm font-medium">Next 5 Runs</h4>
      </div>
      <div className="space-y-2">
        {nextRuns.map((run, index) => (
          <div
            key={index}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-gray-600">Run {index + 1}:</span>
            <span className="font-mono">{run.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

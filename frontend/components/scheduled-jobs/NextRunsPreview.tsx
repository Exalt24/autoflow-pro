"use client";

import { useMemo } from "react";
import { Clock } from "lucide-react";

interface NextRunsPreviewProps {
  cronSchedule: string;
}

function parseExpression(expression: string) {
  try {
    const parts = expression.split(" ");
    if (parts.length !== 5) return null;
    return parts;
  } catch {
    return null;
  }
}

function getNextRuns(cronSchedule: string, count: number = 5): Date[] {
  const parts = parseExpression(cronSchedule);
  if (!parts) return [];

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const runs: Date[] = [];
  const now = new Date();
  let current = new Date(now);

  for (let i = 0; i < count && runs.length < count; i++) {
    current = new Date(current.getTime() + 60000);

    const m = current.getMinutes();
    const h = current.getHours();
    const d = current.getDate();
    const mo = current.getMonth() + 1;
    const dw = current.getDay();

    const minuteMatch =
      minute === "*" ||
      minute === m.toString() ||
      (minute.startsWith("*/") && m % parseInt(minute.slice(2)) === 0);

    const hourMatch =
      hour === "*" ||
      hour === h.toString() ||
      (hour.startsWith("*/") && h % parseInt(hour.slice(2)) === 0);

    const dayOfMonthMatch = dayOfMonth === "*" || dayOfMonth === d.toString();
    const monthMatch = month === "*" || month === mo.toString();
    const dayOfWeekMatch = dayOfWeek === "*" || dayOfWeek === dw.toString();

    if (
      minuteMatch &&
      hourMatch &&
      dayOfMonthMatch &&
      monthMatch &&
      dayOfWeekMatch
    ) {
      runs.push(new Date(current));
      current = new Date(current.getTime() + 60000);
    }

    if (i > 10000) break;
  }

  return runs.slice(0, count);
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

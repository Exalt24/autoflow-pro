"use client";

import { useEffect, useRef, useState, memo } from "react";
import { LogEntry } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { formatDate } from "@/lib/utils";
import { Info, AlertTriangle, XCircle } from "lucide-react";

interface LogViewerProps {
  logs: LogEntry[];
  streaming?: boolean;
  maxHeight?: string;
}

const LogItem = memo(function LogItem({ log }: { log: LogEntry }) {
  const getLogIcon = (level: string) => {
    switch (level) {
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "warn":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-700 bg-red-50";
      case "warn":
        return "text-yellow-700 bg-yellow-50";
      default:
        return "text-gray-700 bg-gray-50";
    }
  };

  return (
    <div
      className={`p-3 flex items-start gap-3 ${getLogColor(
        log.level
      )} border-b`}
    >
      {getLogIcon(log.level)}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-gray-500">
            {formatDate(log.timestamp)}
          </span>
          {log.step_id && (
            <span className="text-xs px-2 py-0.5 bg-gray-200 rounded">
              {log.step_id}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap wrap-break-word text-sm">
          {log.message}
        </p>
      </div>
    </div>
  );
});

export function LogViewer({
  logs,
  streaming = false,
  maxHeight = "500px",
}: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && containerRef.current && logs.length > 0) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  if (logs.length === 0) {
    return (
      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-medium">Execution Logs</h3>
          {streaming && (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm text-gray-600">Live</span>
            </div>
          )}
        </div>
        <div className="p-8 text-center text-gray-500">
          No logs yet. Logs will appear here during execution.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-medium">Execution Logs ({logs.length})</h3>
        <div className="flex items-center gap-4">
          {streaming && (
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-sm text-gray-600">Live</span>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded"
            />
            Auto-scroll
          </label>
        </div>
      </div>
      <div
        ref={containerRef}
        className="overflow-y-auto font-mono text-sm"
        style={{ maxHeight }}
      >
        {logs.map((log, index) => (
          <LogItem key={`${log.timestamp}-${index}`} log={log} />
        ))}
      </div>
    </Card>
  );
}

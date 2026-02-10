"use client";

import { useEffect, useState } from "react";
import { Execution, LogEntry, workflowsApi, executionsApi } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { LogViewer } from "./LogViewer";
import { ScreenshotGallery } from "./ScreenshotGallery";
import { DataViewer } from "./DataViewer";
import { formatDate, formatDuration, getStatusColor } from "@/lib/utils";
import { Clock, Calendar, Play, AlertCircle } from "lucide-react";
import { subscribeToExecution } from "@/lib/websocket";
import { useRouter } from "next/navigation";

interface ExecutionDetailProps {
  execution: Execution;
}

export function ExecutionDetail({
  execution: initialExecution,
}: ExecutionDetailProps) {
  const router = useRouter();
  const [execution, setExecution] = useState(initialExecution);
  const [logs, setLogs] = useState<LogEntry[]>(initialExecution.logs || []);
  const [workflowName, setWorkflowName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{message: string; type: "success" | "error"} | null>(null);

  useEffect(() => {
    // Fetch workflow name
    const fetchWorkflow = async () => {
      try {
        const workflow = await workflowsApi.getById(execution.workflow_id);
        setWorkflowName(workflow.name);
      } catch (error) {
        console.error("Failed to fetch workflow:", error);
      }
    };
    fetchWorkflow();

    // Fetch logs from dedicated endpoint (logs are stored in execution_logs table, not in execution record)
    const fetchLogs = async () => {
      try {
        const result = await executionsApi.getLogs(execution.id, { limit: 1000 });
        setLogs(result.logs);
      } catch (error) {
        console.error("Failed to fetch logs:", error);
      }
    };
    fetchLogs();

    // Subscribe to real-time updates if execution is running
    if (execution.status === "running" || execution.status === "queued") {
      const cleanup = subscribeToExecution(execution.id, {
        onStatus: (update) => {
          setExecution((prev) => ({ ...prev, status: update.status }));
        },
        onLog: (update) => {
          setLogs((prev) => [...prev, update.log]);
        },
        onCompleted: (data) => {
          setExecution((prev) => ({
            ...prev,
            status: "completed",
            extracted_data: data.extractedData,
          }));
        },
        onFailed: (error) => {
          setExecution((prev) => ({
            ...prev,
            status: "failed",
            error_message: error.error,
          }));
        },
      });

      return () => {
        cleanup();
      };
    }
  }, [execution.id, execution.workflow_id, execution.status]);

  const handleRetry = async () => {
    setLoading(true);
    try {
      const result = await workflowsApi.execute(execution.workflow_id);
      setToast({message: `Workflow execution restarted! New execution ID: ${result.executionId}`, type: "success"});
      router.push(`/dashboard/executions/${result.executionId}`);
    } catch (error) {
      console.error("Failed to retry execution:", error);
      setToast({message: "Failed to restart execution", type: "error"});
    } finally {
      setLoading(false);
    }
  };

  // Use actual screenshots from execution data; show empty state if none
  const screenshots = (execution as any).screenshots || [];

  return (
    <div className="space-y-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Header */}
      <Card>
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold mb-2">
                {workflowName || "Loading..."}
              </h2>
              <p className="text-gray-600 text-sm">
                Execution ID: {execution.id}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge className={getStatusColor(execution.status)}>
                {execution.status.toUpperCase()}
              </Badge>
              {execution.status === "failed" && (
                <Button
                  variant="secondary"
                  onClick={handleRetry}
                  loading={loading}
                >
                  <Play className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Started</p>
                <p className="text-sm font-medium">
                  {formatDate(execution.started_at)}
                </p>
              </div>
            </div>

            {execution.completed_at && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Completed</p>
                  <p className="text-sm font-medium">
                    {formatDate(execution.completed_at)}
                  </p>
                </div>
              </div>
            )}

            {execution.duration && (
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-400" />
                <div>
                  <p className="text-xs text-gray-500">Duration</p>
                  <p className="text-sm font-medium">
                    {formatDuration(execution.duration)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-gray-400" />
              <div>
                <p className="text-xs text-gray-500">Steps</p>
                <p className="text-sm font-medium">{logs.length} logs</p>
              </div>
            </div>
          </div>

          {execution.error_message && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">
                  Execution Failed
                </p>
                <p className="text-sm text-red-700 mt-1">
                  {execution.error_message}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Logs */}
      <LogViewer logs={logs} streaming={execution.status === "running"} />

      {/* Extracted Data */}
      {execution.extracted_data &&
        Object.keys(execution.extracted_data).length > 0 && (
          <DataViewer
            data={execution.extracted_data}
            executionId={execution.id}
          />
        )}

      {/* Screenshots */}
      <ScreenshotGallery screenshots={screenshots} />
    </div>
  );
}

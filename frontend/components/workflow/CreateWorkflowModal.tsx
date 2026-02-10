"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { WorkflowForm } from "./WorkflowForm";
import { workflowsApi, WorkflowDefinition } from "@/lib/api";
import { useRouter } from "next/navigation";

interface CreateWorkflowModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreateWorkflowModal({
  open,
  onClose,
  onSuccess,
}: CreateWorkflowModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) {
      setError(null);
      setIsLoading(false);
    }
  }, [open]);

  const handleSubmit = async (data: {
    name: string;
    description: string;
    status: string;
    definition: WorkflowDefinition;
  }) => {
    setError(null);
    setIsLoading(true);

    try {
      await workflowsApi.create({
        name: data.name,
        description: data.description,
        status: data.status as "draft" | "active" | "archived",
        definition: data.definition,
      });

      onClose();
      if (onSuccess) {
        onSuccess();
      }
      router.refresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to create workflow"
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create New Workflow" size="xl">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <WorkflowForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        submitLabel="Create Workflow"
        isLoading={isLoading}
      />
    </Modal>
  );
}

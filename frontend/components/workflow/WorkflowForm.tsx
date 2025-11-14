"use client";

import { useState } from "react";
import { WorkflowDefinition, WorkflowStep } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StepForm } from "./StepForm";
import { Plus } from "lucide-react";
import {
  validateWorkflowName,
  validateWorkflowDefinition,
} from "@/lib/workflowValidation";

interface WorkflowFormProps {
  initialName?: string;
  initialDescription?: string;
  initialStatus?: "draft" | "active" | "archived";
  initialDefinition?: WorkflowDefinition;
  onSubmit: (data: {
    name: string;
    description: string;
    status: string;
    definition: WorkflowDefinition;
  }) => void;
  onCancel: () => void;
  submitLabel?: string;
  isLoading?: boolean;
}

export function WorkflowForm({
  initialName = "",
  initialDescription = "",
  initialStatus = "draft",
  initialDefinition,
  onSubmit,
  onCancel,
  submitLabel = "Create Workflow",
  isLoading = false,
}: WorkflowFormProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [status, setStatus] = useState(initialStatus);
  const [steps, setSteps] = useState<WorkflowStep[]>(
    initialDefinition?.steps || []
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const addStep = () => {
    const newStep: WorkflowStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: "navigate",
      config: {},
    };
    setSteps([...steps, newStep]);
  };

  const updateStep = (index: number, updatedStep: WorkflowStep) => {
    const newSteps = [...steps];
    newSteps[index] = updatedStep;
    setSteps(newSteps);
  };

  const deleteStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, direction: "up" | "down") => {
    const newSteps = [...steps];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    [newSteps[index], newSteps[targetIndex]] = [
      newSteps[targetIndex],
      newSteps[index],
    ];
    setSteps(newSteps);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const nameError = validateWorkflowName(name);
    if (nameError) {
      setErrors({ [nameError.field]: nameError.message });
      return;
    }

    const definition: WorkflowDefinition = { steps };
    const validationErrors = validateWorkflowDefinition(definition);

    if (validationErrors.length > 0) {
      const errorMap: Record<string, string> = {};
      validationErrors.forEach((error) => {
        errorMap[error.field] = error.message;
      });
      setErrors(errorMap);
      return;
    }

    onSubmit({ name, description, status, definition });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 overflow-y-scroll max-h-[70vh] pr-2"
    >
      <div className="space-y-4">
        <Input
          label="Workflow Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Automation Workflow"
          error={errors.name}
          required
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this workflow does..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            rows={3}
          />
        </div>

        <Select
          label="Status"
          value={status}
          onChange={(e) =>
            setStatus(e.target.value as "draft" | "active" | "archived")
          }
          options={[
            { value: "draft", label: "Draft - Not ready to run" },
            { value: "active", label: "Active - Ready to use" },
            { value: "archived", label: "Archived - No longer in use" },
          ]}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Workflow Steps</h3>
          <Button type="button" variant="secondary" size="sm" onClick={addStep}>
            <Plus className="h-4 w-4 mr-2" />
            Add Step
          </Button>
        </div>

        {errors.steps && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{errors.steps}</p>
          </div>
        )}

        {steps.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
            <p className="text-gray-500 mb-4">
              No steps yet. Add your first step to get started.
            </p>
            <Button type="button" variant="secondary" onClick={addStep}>
              <Plus className="h-4 w-4 mr-2" />
              Add First Step
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {steps.map((step, index) => (
              <StepForm
                key={step.id}
                step={step}
                index={index}
                totalSteps={steps.length}
                onChange={(updatedStep) => updateStep(index, updatedStep)}
                onDelete={() => deleteStep(index)}
                onMoveUp={index > 0 ? () => moveStep(index, "up") : undefined}
                onMoveDown={
                  index < steps.length - 1
                    ? () => moveStep(index, "down")
                    : undefined
                }
                errors={errors}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button type="submit" loading={isLoading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

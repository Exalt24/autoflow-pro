"use client";

import { WorkflowStep } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StepTypeSelector, getStepTypeLabel } from "./StepTypeSelector";
import { Card } from "@/components/ui/Card";
import { Trash2, ChevronUp, ChevronDown } from "lucide-react";

interface StepFormProps {
  step: WorkflowStep;
  index: number;
  totalSteps: number;
  onChange: (step: WorkflowStep) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  errors?: Record<string, string>;
}

export function StepForm({
  step,
  index,
  totalSteps,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  errors,
}: StepFormProps) {
  const updateConfig = (key: string, value: unknown) => {
    onChange({
      ...step,
      config: { ...step.config, [key]: value },
    });
  };

  const renderConfigFields = () => {
    switch (step.type) {
      case "navigate":
        return (
          <Input
            label="URL"
            value={(step.config.url as string) || ""}
            onChange={(e) => updateConfig("url", e.target.value)}
            placeholder="https://example.com"
            error={errors?.[`step-${step.id}-url`]}
          />
        );

      case "click":
        return (
          <>
            <Input
              label="CSS Selector"
              value={(step.config.selector as string) || ""}
              onChange={(e) => updateConfig("selector", e.target.value)}
              placeholder="#submit-button or .btn-primary"
              error={errors?.[`step-${step.id}-selector`]}
            />
            <p className="text-sm text-gray-500 mt-1">
              Tip: Use browser DevTools to find selectors. Right-click element →
              Inspect
            </p>
          </>
        );

      case "fill":
        return (
          <>
            <Input
              label="CSS Selector"
              value={(step.config.selector as string) || ""}
              onChange={(e) => updateConfig("selector", e.target.value)}
              placeholder="#email or input[name='username']"
              error={errors?.[`step-${step.id}-selector`]}
            />
            <Input
              label="Value to Enter"
              value={(step.config.value as string) || ""}
              onChange={(e) => updateConfig("value", e.target.value)}
              placeholder="Text to type into the field"
              error={errors?.[`step-${step.id}-value`]}
            />
          </>
        );

      case "extract":
        return (
          <>
            <Input
              label="CSS Selector"
              value={(step.config.selector as string) || ""}
              onChange={(e) => updateConfig("selector", e.target.value)}
              placeholder=".product-price or h1.title"
              error={errors?.[`step-${step.id}-selector`]}
            />
            <Input
              label="Field Name"
              value={(step.config.fieldName as string) || ""}
              onChange={(e) => updateConfig("fieldName", e.target.value)}
              placeholder="price or title"
              error={errors?.[`step-${step.id}-fieldName`]}
            />
            <Input
              label="Attribute (optional)"
              value={(step.config.attribute as string) || ""}
              onChange={(e) => updateConfig("attribute", e.target.value)}
              placeholder="href, src, or leave empty for text"
            />
          </>
        );

      case "wait":
        return (
          <>
            <Input
              label="Duration (milliseconds)"
              type="number"
              value={(step.config.duration as number) || ""}
              onChange={(e) =>
                updateConfig("duration", parseInt(e.target.value) || 0)
              }
              placeholder="1000 for 1 second"
              error={errors?.[`step-${step.id}-duration`]}
            />
            <p className="text-sm text-gray-500 mt-1">OR</p>
            <Input
              label="Wait for Element (CSS Selector)"
              value={(step.config.selector as string) || ""}
              onChange={(e) => updateConfig("selector", e.target.value)}
              placeholder=".loading-complete"
            />
          </>
        );

      case "screenshot":
        return (
          <Input
            label="Element Selector (optional)"
            value={(step.config.selector as string) || ""}
            onChange={(e) => updateConfig("selector", e.target.value)}
            placeholder="Leave empty for full page screenshot"
          />
        );

      case "scroll":
        return (
          <>
            <Input
              label="Element Selector"
              value={(step.config.selector as string) || ""}
              onChange={(e) => updateConfig("selector", e.target.value)}
              placeholder=".target-section"
              error={errors?.[`step-${step.id}-selector`]}
            />
            <p className="text-sm text-gray-500 mt-1">OR</p>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="X Position"
                type="number"
                value={(step.config.x as number) || ""}
                onChange={(e) =>
                  updateConfig("x", parseInt(e.target.value) || 0)
                }
                placeholder="0"
              />
              <Input
                label="Y Position"
                type="number"
                value={(step.config.y as number) || ""}
                onChange={(e) =>
                  updateConfig("y", parseInt(e.target.value) || 0)
                }
                placeholder="500"
              />
            </div>
          </>
        );

      case "hover":
        return (
          <Input
            label="CSS Selector"
            value={(step.config.selector as string) || ""}
            onChange={(e) => updateConfig("selector", e.target.value)}
            placeholder=".menu-item"
            error={errors?.[`step-${step.id}-selector`]}
          />
        );

      case "press_key":
        return (
          <Input
            label="Key"
            value={(step.config.key as string) || ""}
            onChange={(e) => updateConfig("key", e.target.value)}
            placeholder="Enter, Escape, Tab, etc."
            error={errors?.[`step-${step.id}-key`]}
          />
        );

      case "execute_js":
        return (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                JavaScript Code
              </label>
              <textarea
                value={(step.config.script as string) || ""}
                onChange={(e) => updateConfig("script", e.target.value)}
                placeholder="return document.title;"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                rows={4}
              />
              {errors?.[`step-${step.id}-script`] && (
                <p className="text-sm text-red-600 mt-1">
                  {errors[`step-${step.id}-script`]}
                </p>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Code runs in browser context. Use return to get values.
            </p>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-500">
                Step {index + 1}
              </span>
              <span className="text-xs px-2 py-1 bg-gray-100 rounded">
                {getStepTypeLabel(step.type)}
              </span>
            </div>
            <StepTypeSelector
              value={step.type}
              onChange={(type) => onChange({ ...step, type, config: {} })}
            />
          </div>
          <div className="flex items-center gap-2 ml-4">
            {index > 0 && (
              <Button variant="ghost" size="icon" onClick={onMoveUp}>
                <ChevronUp className="h-4 w-4" />
              </Button>
            )}
            {index < totalSteps - 1 && (
              <Button variant="ghost" size="icon" onClick={onMoveDown}>
                <ChevronDown className="h-4 w-4" />
              </Button>
            )}
            <Button variant="danger" size="icon" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-4">{renderConfigFields()}</div>
      </div>
    </Card>
  );
}

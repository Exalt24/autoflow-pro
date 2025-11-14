"use client";

import { StepType } from "@/lib/api";
import { Select } from "@/components/ui/Select";

interface StepTypeInfo {
  value: StepType;
  label: string;
  description: string;
  category: "navigation" | "interaction" | "data" | "logic" | "control";
}

const STEP_TYPES: StepTypeInfo[] = [
  {
    value: "navigate",
    label: "Navigate to URL",
    description: "Open a web page",
    category: "navigation",
  },
  {
    value: "click",
    label: "Click Element",
    description: "Click on a button or link",
    category: "interaction",
  },
  {
    value: "fill",
    label: "Fill Form Field",
    description: "Enter text into an input",
    category: "interaction",
  },
  {
    value: "extract",
    label: "Extract Data",
    description: "Get text or attributes from elements",
    category: "data",
  },
  {
    value: "wait",
    label: "Wait",
    description: "Pause for duration or element",
    category: "control",
  },
  {
    value: "screenshot",
    label: "Take Screenshot",
    description: "Capture page or element",
    category: "data",
  },
  {
    value: "scroll",
    label: "Scroll",
    description: "Scroll to element or position",
    category: "interaction",
  },
  {
    value: "hover",
    label: "Hover",
    description: "Mouse over an element",
    category: "interaction",
  },
  {
    value: "press_key",
    label: "Press Key",
    description: "Simulate keyboard input",
    category: "interaction",
  },
  {
    value: "execute_js",
    label: "Execute JavaScript",
    description: "Run custom JavaScript code",
    category: "logic",
  },
];

interface StepTypeSelectorProps {
  value: StepType;
  onChange: (value: StepType) => void;
  label?: string;
  error?: string;
}

export function StepTypeSelector({
  value,
  onChange,
  label = "Step Type",
  error,
}: StepTypeSelectorProps) {
  const options = STEP_TYPES.map((type) => ({
    value: type.value,
    label: `${type.label} - ${type.description}`,
  }));

  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as StepType)}
      options={options}
      error={error}
    />
  );
}

export function getStepTypeLabel(type: StepType): string {
  return STEP_TYPES.find((t) => t.value === type)?.label || type;
}

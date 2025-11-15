"use client";

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

interface KeyboardShortcutsProps {
  selectedNodeId: string | null;
  onDeleteNode: (nodeId: string) => void;
  onDeselectNode: () => void;
  onFitView: () => void;
  onSave: () => void;
}

export function KeyboardShortcuts({
  selectedNodeId,
  onDeleteNode,
  onDeselectNode,
  onFitView,
  onSave,
}: KeyboardShortcutsProps) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      if (event.key === "Delete" && selectedNodeId && !isInput) {
        event.preventDefault();
        onDeleteNode(selectedNodeId);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onDeselectNode();
      }

      if (event.key === "f" && !isInput) {
        event.preventDefault();
        fitView({ padding: 0.2, duration: 300 });
        onFitView();
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        onSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedNodeId,
    onDeleteNode,
    onDeselectNode,
    onFitView,
    onSave,
    fitView,
  ]);

  return null;
}

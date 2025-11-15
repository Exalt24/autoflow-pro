export const STEP_TYPES = {
  navigate: {
    label: "Navigate",
    description: "Navigate to a URL",
    category: "Navigation",
    color: "#6A9BA6",
  },
  click: {
    label: "Click",
    description: "Click an element",
    category: "Interaction",
    color: "#346C73",
  },
  fill: {
    label: "Fill",
    description: "Fill a form field",
    category: "Interaction",
    color: "#346C73",
  },
  extract: {
    label: "Extract",
    description: "Extract data from page",
    category: "Data",
    color: "#A3C9D9",
  },
  wait: {
    label: "Wait",
    description: "Wait for duration or element",
    category: "Control",
    color: "#103B40",
  },
  screenshot: {
    label: "Screenshot",
    description: "Capture screenshot",
    category: "Data",
    color: "#A3C9D9",
  },
  scroll: {
    label: "Scroll",
    description: "Scroll page or element",
    category: "Interaction",
    color: "#346C73",
  },
  hover: {
    label: "Hover",
    description: "Hover over element",
    category: "Interaction",
    color: "#346C73",
  },
  press_key: {
    label: "Press Key",
    description: "Press keyboard key",
    category: "Interaction",
    color: "#346C73",
  },
  execute_js: {
    label: "Execute JS",
    description: "Run JavaScript code",
    category: "Advanced",
    color: "#012326",
  },
  conditional: {
    label: "Conditional",
    description: "If/else branching",
    category: "Logic",
    color: "#103B40",
  },
  loop: {
    label: "Loop",
    description: "Repeat steps",
    category: "Logic",
    color: "#103B40",
  },
} as const;

export const CATEGORIES = [
  "Navigation",
  "Interaction",
  "Data",
  "Control",
  "Logic",
  "Advanced",
] as const;

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 80;
export const GRID_SIZE = 15;

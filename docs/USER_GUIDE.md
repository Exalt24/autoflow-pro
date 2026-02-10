# AutoFlow Pro User Guide

This guide covers every feature of AutoFlow Pro, a browser-automation platform built on Playwright. It is written to be useful to both humans reading it directly and LLMs that need to generate or troubleshoot workflows programmatically.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Creating Workflows](#creating-workflows)
3. [Step Types (All 23)](#step-types)
4. [Executing Workflows](#executing-workflows)
5. [Scheduling Workflows](#scheduling-workflows)
6. [Analytics and Monitoring](#analytics-and-monitoring)
7. [Data Management](#data-management)
8. [Tips and Best Practices](#tips-and-best-practices)
9. [Troubleshooting](#troubleshooting)
10. [Limits and Quotas](#limits-and-quotas)

---

## Getting Started

### 1. Create an Account

1. Visit the AutoFlow Pro application.
2. Click "Sign Up".
3. Enter your email and password.
4. Verify your email if prompted.
5. Log in to reach the dashboard.

### 2. Dashboard Overview

After logging in you will see four summary cards:

- **Workflows** — total workflows created.
- **Executions** — total executions this month.
- **Success Rate** — percentage of successful executions.
- **Average Duration** — mean execution time.

---

## Creating Workflows

### Using the Form Builder

1. Go to the **Workflows** page.
2. Click **"Create Workflow"**.
3. Fill in the details:
   - **Name** — a descriptive name (e.g., "Daily Price Check").
   - **Description** — optional free-text description.
   - **Status** — Draft, Active, or Archived.
4. Click **"Add Step"** to append automation steps.
5. Configure each step (see Step Types below).
6. Click **"Save Workflow"**.

### Using the Visual Builder

1. Go to the **Workflows** page and click on a workflow.
2. Click the **Network icon** (Visual Builder).
3. Drag step types from the left palette onto the canvas.
4. Click a node to configure it in the right panel.
5. Connect nodes by dragging from an output handle to an input handle.
6. Click **"Save"** in the toolbar.

---

## Step Types

AutoFlow Pro provides **23 node types** organized into **6 categories**. Each category has a distinct color in the visual builder.

### Engine Defaults (apply to all steps)

| Setting | Value |
|---------|-------|
| Browser | Steel.dev cloud browser via `BROWSER_WS_URL`; falls back to local Chromium |
| Headless | `true` |
| Viewport | 1920 x 1080 |
| User Agent | Windows Mozilla/5.0 |
| Default timeout | 30 000 ms (30 seconds) for all selector waits |
| Max concurrent workers | 2 |
| Screenshot on error | `true` |
| Variable substitution | All config string values undergo `{{variableName}}` replacement before execution |
| Max iterations (loops) | 100 (configurable up to 1000) |

---

### Category 1 — NAVIGATION (color `#6A9BA6`)

#### 1. Navigate

Category: Navigation | Color: `#6A9BA6`

Opens a URL in the browser. Internally calls `page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })`, then waits for network idle with a 5-second soft timeout.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| URL | Yes | text | `https://example.com` | Must be a non-empty string. |

**Backend config key:** `url`

**Returns:** `{ url: <final page URL after navigation> }`

**Example:** Set URL to `https://example.com/products` to open the products page and wait for it to finish loading.

---

### Category 2 — INTERACTION (color `#346C73`)

#### 2. Click

Category: Interaction | Color: `#346C73`

Waits for the selector to become visible (30 s), clicks the element, then waits for `domcontentloaded`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `.button, #submit, [data-test='btn']` | CSS selector or XPath. Helper text: "CSS selector or XPath. Right-click > Inspect in browser to find." |

**Backend config key:** `selector`

**Returns:** `{ clicked: <selector> }`

**Example:** Set Selector to `button#add-to-cart` to click the "Add to Cart" button.

---

#### 3. Fill

Category: Interaction | Color: `#346C73`

Waits for the selector to become visible (30 s), then calls `page.fill(selector, String(value))`. Replaces any existing content in the field.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `input[name='email']` | CSS selector of the input element. |
| Value | Yes | text | `Text to fill` | The string to type into the field. Supports `{{variable}}` substitution. |

**Backend config keys:** `selector`, `value`

**Returns:** `{ filled: <selector>, value: <value> }`

**Example:** Selector = `input[name='email']`, Value = `user@example.com`.

---

#### 4. Scroll

Category: Interaction | Color: `#346C73`

Scrolls the page. If a selector is provided, calls `locator(selector).scrollIntoViewIfNeeded()`. If x/y coordinates are provided instead, calls `window.scrollTo(x, y)`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | No | text | `.element-to-scroll-to` | Helper text: "Or use X/Y coordinates below". |
| X Position | No | number | (none) | Horizontal scroll position in pixels. |
| Y Position | No | number | (none) | Vertical scroll position in pixels. |

**Validation:** At least one of Selector or X/Y must be provided.

**Backend config keys:** `selector` OR `x` / `y`

**Returns:** `{ scrolled: "element", ... }` or `{ scrolled: "position", ... }`

**Example:** Set Selector to `#footer` to scroll the footer into view, or set X = 0, Y = 2000 to scroll down 2000 pixels.

---

#### 5. Hover

Category: Interaction | Color: `#346C73`

Waits for the selector to become visible (30 s), then calls `page.hover(selector)`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `.button, #submit, [data-test='btn']` | Same placeholder as Click. |

**Backend config key:** `selector`

**Returns:** `{ hovered: <selector> }`

**Example:** Set Selector to `.dropdown-trigger` to reveal a dropdown menu on hover.

---

#### 6. Press Key

Category: Interaction | Color: `#346C73`

Presses a keyboard key. If a selector is provided, focuses that element first via `locator(selector).press(key)`. If no selector is given, presses globally via `page.keyboard.press(key)`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Key | Yes | text | `Enter, Escape, Tab, ArrowDown` | Playwright key name. |
| Selector | No | text | (none) | Optional element to focus before pressing. |

**Backend config keys:** `key`, `selector` (optional)

**Returns:** `{ pressed: <key>, selector: <selector> }`

**Example:** Set Key to `Enter` to submit a form, or set Selector to `input#search` and Key to `Enter` to press Enter inside the search box.

---

#### 7. Select Dropdown

Category: Interaction | Color: `#346C73`

Waits for the selector to become visible (30 s), then calls `page.selectOption()` using the chosen selection method (value, label, or index).

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `select#country` | Must point to a `<select>` element. |
| Select By | Yes | dropdown | Value / Label / Index | Determines which of the three conditional fields appears. |
| Value | Conditional | text | `us` | Shown when Select By = "Value". The `<option value="...">` to match. |
| Label | Conditional | text | `United States` | Shown when Select By = "Label". The visible text of the option. |
| Index | Conditional | number | (none) | Shown when Select By = "Index". Zero-based index of the option. |

**Backend config keys:** `selector`, `value` / `label` / `index`

**Returns:** `{ selector, value, label, index }`

**Example:** Selector = `select#country`, Select By = Label, Label = `United States`.

---

#### 8. Right Click

Category: Interaction | Color: `#346C73`

Waits for the selector to become visible (30 s), then calls `page.click(selector, { button: "right" })`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `.context-menu-target` | Element to right-click. |

**Backend config key:** `selector`

**Returns:** `{ rightClicked: <selector> }`

**Example:** Set Selector to `.file-row` to open a context menu on a file list item.

---

#### 9. Double Click

Category: Interaction | Color: `#346C73`

Waits for the selector to become visible (30 s), then calls `page.dblclick(selector)`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `.context-menu-target` | Element to double-click. |

**Backend config key:** `selector`

**Returns:** `{ doubleClicked: <selector> }`

**Example:** Set Selector to `.editable-cell` to activate inline editing.

---

#### 10. Drag and Drop

Category: Interaction | Color: `#346C73`

Waits for both selectors to become visible (30 s each), then calls `source.dragTo(target)`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Source Selector | Yes | text | `.draggable-item` | The element to drag. |
| Target Selector | Yes | text | `.drop-zone` | The element to drop onto. |

**Backend config keys:** `sourceSelector`, `targetSelector`

**Returns:** `{ dragged: <sourceSelector>, droppedOn: <targetSelector> }`

**Example:** Source Selector = `.task-card`, Target Selector = `.column-done` to move a kanban card.

---

### Category 3 — DATA (color `#A3C9D9`)

#### 11. Extract

Category: Data | Color: `#A3C9D9`

Waits for the selector to become attached to the DOM (30 s). If the `multiple` flag is set, collects all matching elements; otherwise takes the first match. Extracts the specified attribute, or `textContent` if no attribute is given.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `.price, h1, [data-id]` | CSS selector for the target element(s). |
| Field Name | Yes | text | `productPrice` | Key name under which the extracted value is stored in the execution's extracted data. |
| Attribute | No | text | `href, src, data-id` | Helper text: "Leave empty to extract text content". |

**Backend config keys:** `selector`, `fieldName`, `attribute` (optional), `multiple` (optional boolean)

**Returns:** A single string value, or an array of strings when multiple elements are matched.

**Example:** Selector = `h1.product-title`, Field Name = `title`, Attribute = (empty) — extracts the text of the first `<h1>` with class `product-title`.

---

#### 12. Screenshot

Category: Data | Color: `#A3C9D9`

Captures a screenshot. If a selector is provided, waits for the element to become visible (30 s) and screenshots just that element. If no selector is given, takes a full-page screenshot via `page.screenshot({ fullPage: true })`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | No | text | `Leave empty for full page` | Optional. If omitted, captures the entire page. |

**Validation:** Always valid — no required fields.

**Backend config keys:** `selector` (optional), `fullPage` (optional, defaults to `true`)

**Returns:** A Buffer containing the screenshot image.

**Example:** Leave Selector empty to capture the full page, or set it to `.chart-container` to capture only the chart.

---

#### 13. Set Variable

Category: Data | Color: `#A3C9D9`

Pure variable manipulation; no Playwright browser interaction. Stores a value in `context.variables[variableName]`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Variable Name | Yes | text | `myVariable` | Helper text: "Alphanumeric characters and underscores only". |
| Value | Yes | text | `Hello or ${otherVariable}` | Helper text: "Can use ${variableName} to reference other variables". |

**Backend config keys:** `variableName`, `variableValue`

**Returns:** `{ <variableName>: <variableValue> }`

**Example:** Variable Name = `baseUrl`, Value = `https://example.com` — later steps can reference `{{baseUrl}}`.

---

#### 14. Extract to Variable

Category: Data | Color: `#A3C9D9`

Waits for the selector to become attached to the DOM (30 s), extracts an attribute or `textContent`, and stores the result in `context.variables[variableName]` for use in later steps.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Selector | Yes | text | `.product-name, h1` | CSS selector for the target element. |
| Variable Name | Yes | text | `productName` | Helper text: "Variable will store the extracted value". |
| Attribute | No | text | `href, src, data-id` | Helper text: "Leave empty to extract text content". |

**Backend config keys:** `selector`, `variableName`, `attribute` (optional)

**Returns:** `{ <variableName>: <extractedValue> }`

**Example:** Selector = `.price-tag`, Variable Name = `currentPrice`, Attribute = (empty) — stores the price text in `{{currentPrice}}`.

---

#### 15. Download File

Category: Data | Color: `#A3C9D9`

Triggers a file download by either clicking an element or navigating to a URL. Optionally waits for the download to complete and uploads the file to Supabase Storage (max 10 MB).

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Trigger Method | Yes | dropdown | `Click Element` / `Navigate to URL` | Determines which conditional field appears next. |
| Selector | Conditional | text | `a[download], button.download` | Shown when Trigger Method = "Click Element". |
| Download URL | Conditional | text | `https://example.com/file.pdf` | Shown when Trigger Method = "Navigate to URL". |
| Wait for download | Yes | checkbox | Checked (true) | Helper text: "If unchecked, only triggers download without waiting". |

**Info box (shown in UI):** "Downloaded files are stored in Supabase Storage under workflow-attachments bucket. Max file size: 10MB."

**Validation:** `triggerMethod` must exist (defaults to "click").

**Backend config keys:** `selector` OR `url`, `triggerMethod`, `waitForDownload` (boolean)

**Returns (when waiting):** `{ filename, size, path, status }`

**Returns (when not waiting):** `{ status: "download_triggered" }`

**Example:** Trigger Method = "Click Element", Selector = `a.export-csv` — clicks the export link and waits for the CSV to download.

---

### Category 4 — CONTROL (color `#103B40`)

#### 16. Wait

Category: Control | Color: `#103B40`

Pauses execution. If a selector is provided, calls `page.waitForSelector(selector, { state, timeout: 30000 })`. If only a duration is provided, calls `page.waitForTimeout(duration)`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Duration (ms) | No | number | Default: `1000`, step: `100` | Helper text: "Or specify selector below to wait for element". |
| Selector | No | text | `.loaded, #content` | Waits for this element to reach the specified state. |

**Validation:** Either `duration > 0` OR `selector` must be provided (at least one).

**Backend config keys:** `duration` (optional number), `selector` (optional string), `state` (optional: `"visible"` / `"hidden"` / `"attached"`, defaults to `"visible"`)

**Note:** The UI does not expose the `state` field. It always defaults to `"visible"`. To use `"hidden"` or `"attached"`, set it via the API or raw JSON config.

**Returns:** `{ waited: "element", ... }` or `{ waited: "duration", ... }`

**Example:** Set Duration to `3000` to pause for 3 seconds, or set Selector to `.spinner` to wait until the spinner appears (visible).

---

### Category 5 — LOGIC (color `#103B40`)

#### 17. Conditional

Category: Logic | Color: `#103B40`

Evaluates a condition and stores the boolean result in the step's extracted data. It does **not** automatically branch execution. Downstream steps can inspect `conditionResult` to decide behavior.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Condition Type | Yes | dropdown | Element Exists / Element Visible / Text Contains / Value Comparison / Custom JavaScript | Determines which conditional fields appear. |
| Selector | Conditional | text | (none) | Shown for Element Exists, Element Visible, and Text Contains. |
| Text to Find | Conditional | text | `Search text` | Shown for Text Contains only. |
| Variable Name | Conditional | text | (none) | Shown for Value Comparison. |
| Operator | Conditional | dropdown | Equals / Not Equals / Contains / Does Not Contain / Greater Than / Less Than | Shown for Value Comparison. |
| Value | Conditional | text | `Expected value` | Shown for Value Comparison. |
| JavaScript Condition | Conditional | textarea (6 rows) | `return variables.count > 10;` | Shown for Custom JavaScript. Helper text: "Must return true or false. Access variables via variables.name". |

**Info box (shown in UI):** "Condition result will be stored in extracted data."

**Validation:** `conditionType` must be specified.

**Backend config keys:** `conditionType`, `selector`, `text`, `variableName`, `operator`, `value`, `customScript`

**Returns:** `{ conditionResult: <boolean>, conditionType: <string>, evaluatedAt: <ISO timestamp> }`

**Example:** Condition Type = "Element Exists", Selector = `.error-banner` — returns `conditionResult: true` if an error banner is present on the page.

---

#### 18. Loop

Category: Logic | Color: `#103B40`

Iterates over elements matching a selector, or repeats a fixed number of times. Sets special loop variables on each iteration that child steps can reference.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Loop Type | Yes | dropdown | `Loop Over Elements` / `Loop N Times` | Determines which conditional field appears. |
| Selector | Conditional | text | `.item, li, tr, .product` | Shown for "Loop Over Elements". Helper text: "Loop will iterate over all matching elements". |
| Count | Conditional | number | `5` (min: 1) | Shown for "Loop N Times". Helper text: "Number of times to repeat". |
| Max Iterations | No | number | Default: `100`, min: `1`, max: `1000` | Helper text: "Prevents infinite loops (default: 100)". |

**Validation:** If Loop Type = "elements", then `selector` must be a string. If Loop Type = "count", then `count` must be > 0.

**Loop variables available on each iteration:**

| Variable | Description |
|----------|-------------|
| `${loopIndex}` | Current index (0-based). |
| `${loopIteration}` | Current iteration (1-based). |
| `${loopTotal}` | Total number of iterations. |
| `${loopElementText}` | Text content of the current element (elements mode only). |
| `${loopElementHTML}` | Inner HTML of the current element (elements mode only). |

**Info box (shown in UI):** Lists the five loop variables above.

**Backend config keys:** `loopType`, `selector`, `count`, `maxIterations`

**Returns:** `{ iterations: <count>, totalElements: <count>, results: <array> }`

**Example:** Loop Type = "Loop Over Elements", Selector = `.product-card`, Max Iterations = `50` — iterates over each product card on the page, up to 50.

---

### Category 6 — ADVANCED (color `#012326`)

#### 19. Execute JavaScript

Category: Advanced | Color: `#012326`

Runs custom JavaScript in the browser page context via `page.evaluate()`, wrapping the code in `new Function(code)`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| JavaScript Code | Yes | textarea (6 rows) | `return document.title;` | Helper text: "Use return to get a value". |

**Important note:** The frontend field name is `script`, but the backend reads the config key `code`. The platform handles this mapping internally.

**Validation:** `script` (frontend) must be a non-empty string.

**Backend config key:** `code`

**Returns:** Whatever the JavaScript code returns.

**Example:** Code = `return document.querySelectorAll('.item').length;` — returns the count of items on the page.

---

#### 20. Set Cookie

Category: Advanced | Color: `#012326`

Sets a browser cookie via `context.addCookies([{ name, value, domain, path }])`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Cookie Name | Yes | text | `session_id` | The cookie name. |
| Cookie Value | Yes | text | `abc123` | The cookie value. |
| Domain | No | text | `example.com` | Defaults to the current page hostname if omitted. |

**Backend config keys:** `name`, `value`, `domain` (optional, defaults to current hostname), `path` (optional, defaults to `"/"`)

**Returns:** `{ cookieName, cookieValue }`

**Example:** Cookie Name = `auth_token`, Cookie Value = `eyJhbGci...`, Domain = `api.example.com`.

---

#### 21. Get Cookie

Category: Advanced | Color: `#012326`

Reads a browser cookie by name via `context.cookies()`. Throws an error if the cookie is not found.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Cookie Name | Yes | text | `session_id` | The cookie to look up. |
| Store in Variable | No | text | `cookieValue` | If provided, stores the cookie value in `context.variables[variableName]`. |

**Backend config keys:** `name`, `variableName` (optional)

**Returns:** `{ cookieName, cookieValue }` — also sets `context.variables[variableName]` if the field is provided.

**Error behavior:** Throws an error if no cookie with the given name is found.

**Example:** Cookie Name = `session_id`, Store in Variable = `sessionToken` — the session token is then available as `{{sessionToken}}` in later steps.

---

#### 22. Set localStorage

Category: Advanced | Color: `#012326`

Sets a value in the browser's localStorage via `page.evaluate(() => localStorage.setItem(key, value))`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Key | Yes | text | `user_preferences` | The localStorage key. |
| Value | Yes | text | `{"theme": "dark"}` | The value to store. Must not be undefined. |

**Backend config keys:** `key`, `value`

**Returns:** `{ key, value }`

**Example:** Key = `user_preferences`, Value = `{"theme":"dark","lang":"en"}`.

---

#### 23. Get localStorage

Category: Advanced | Color: `#012326`

Reads a value from the browser's localStorage via `page.evaluate(() => localStorage.getItem(key))`.

**Fields:**

| Field | Required | Type | Placeholder / Default | Notes |
|-------|----------|------|-----------------------|-------|
| Key | Yes | text | `user_preferences` | The localStorage key to read. |
| Store in Variable | No | text | `preferences` | If provided, stores the value in `context.variables[variableName]`. |

**Backend config keys:** `key`, `variableName` (optional)

**Returns:** `{ key, value }` — also sets `context.variables[variableName]` if the field is provided.

**Example:** Key = `user_preferences`, Store in Variable = `prefs` — the value is then available as `{{prefs}}` in later steps.

---

## Frontend Validation Summary

This table lists the validation rules enforced by the `validateNodeConfig` function in `nodeTypes.ts` before a workflow can be saved.

| Node Type | Validation Rule |
|-----------|-----------------|
| navigate | `url` must be a non-empty string |
| click | `selector` must be a non-empty string |
| hover | `selector` must be a non-empty string |
| fill | `selector` AND `value` must both be truthy |
| extract | `selector` AND `fieldName` must both be non-empty strings |
| wait | `duration > 0` OR `selector` must be truthy |
| screenshot | Always valid (no required fields) |
| scroll | `selector` OR (`x` or `y`) must exist |
| press_key | `key` must be a non-empty string |
| execute_js | `script` must be a non-empty string |
| set_variable | `variableName` must be a non-empty string |
| extract_to_variable | `selector` AND `variableName` must both be non-empty strings |
| download_file | `triggerMethod` must exist (defaults to `"click"`) |
| drag_drop | `sourceSelector` AND `targetSelector` must both be truthy |
| set_cookie | `name` AND `value` must both be truthy |
| get_cookie | `name` must be truthy |
| set_localstorage | `key` AND `value` (not undefined) must be truthy |
| get_localstorage | `key` must be truthy |
| select_dropdown | `selector` must be truthy |
| right_click | `selector` must be truthy |
| double_click | `selector` must be truthy |
| conditional | `conditionType` must be specified |
| loop | If `loopType` = "elements" then `selector` must be a string; if "count" then `count > 0` |

---

## Executing Workflows

### Manual Execution

1. Go to the **Workflows** page.
2. Find your workflow.
3. Click the **"Execute"** button.
4. Execution begins immediately.
5. Monitor real-time progress on the **Executions** page.

### Viewing Execution Results

1. Go to the **Executions** page.
2. Click an execution to view its details:
   - **Status** — Queued, Running, Completed, or Failed.
   - **Logs** — step-by-step execution log.
   - **Extracted Data** — data collected during execution.
   - **Screenshots** — screenshots captured (including automatic error screenshots).
   - **Duration** — total execution time.
   - **Error** — error message if the execution failed.

### Real-Time Monitoring

- **Live Indicator** — a green pulsing dot indicates a live execution.
- **Auto-Scroll** — logs auto-scroll as new entries arrive.
- **WebSocket** — real-time updates without page refresh.

---

## Scheduling Workflows

### Creating a Scheduled Job

1. Go to the **Scheduled Jobs** page.
2. Click **"Schedule Workflow"**.
3. Select a workflow from the dropdown.
4. Choose a schedule:
   - **Presets:** Every minute, hourly, daily, weekly, monthly.
   - **Custom:** Enter a cron expression.
5. Preview the next run times.
6. Click **"Create"**.

### Cron Expression Examples

| Expression | Meaning |
|------------|---------|
| `0 9 * * *` | Daily at 9:00 AM |
| `0 */6 * * *` | Every 6 hours |
| `0 9 * * 1` | Every Monday at 9:00 AM |
| `0 9 1 * *` | First day of every month at 9:00 AM |
| `*/15 * * * *` | Every 15 minutes |

### Managing Scheduled Jobs

- **Pause** — click the toggle to pause without deleting.
- **Edit** — click the edit icon to change the schedule.
- **Delete** — click the trash icon to remove the schedule.
- **View History** — click the job card to see its execution history.

### Failure Monitoring

- After **3 consecutive failures**, a warning is displayed.
- After **5 consecutive failures**, the job is automatically paused.
- You can manually resume the job after fixing the underlying issue.

---

## Analytics and Monitoring

### Dashboard Metrics

**Overview Cards:**

- Total workflows created.
- Total executions (with trend indicator).
- Success rate percentage.
- Average execution time.

**Charts:**

- **Execution Volume** — line chart over time. Green = successful, red = failed.
- **Success Rate** — pie chart showing success vs. failure ratio.
- **Top Workflows** — bar chart of most-used workflows.

**Resource Usage:**

- Workflows: up to 10 on free tier.
- Executions: 50 per month.
- Storage: 1 GB total.

### Execution Trends

1. Go to the **Analytics** page.
2. Select a time range (7, 14, 30, or 90 days).
3. Review trends, identify peak usage times, and spot failure patterns.

### Error Analysis

The **Error Table** shows:

- Most common error messages.
- Frequency of each error.
- Last occurrence.
- Affected workflows.
- A "View" link to the failed execution.

Common error messages:

| Error | Meaning |
|-------|---------|
| `Selector not found` | The element does not exist on the page. |
| `Timeout waiting for element` | The element did not appear within 30 seconds. |
| `Navigation failed` | The target website could not be loaded. |
| `JavaScript execution failed` | Custom JavaScript code threw an error. |

### Performance Insights

- **Slowest Workflows** — identify workflows with the longest execution times and optimize by reducing wait times or removing unnecessary steps.
- **High Failure Rates** — workflows with more than 30% failure rate should be investigated for stale selectors or site changes.

---

## Data Management

### Storage Usage

View a breakdown of storage consumed by:

- Execution logs.
- Screenshots.
- Downloaded files.
- Archived data.

### Data Retention Policy

Under **Settings > Retention Policy**, choose one of:

| Option | Description |
|--------|-------------|
| 7 days | Minimal storage, frequent archival. |
| 30 days | Recommended balance. |
| 90 days | Extended history. |

Executions older than the retention period are archived to R2 cold storage. Logs and data are moved but remain accessible (with slower retrieval).

### Archival

- **Automatic:** Runs daily at 2:00 AM.
- **Manual:** Analytics page > "Archive Old Executions".
- Archived data is stored in Cloudflare R2 and does not count toward active storage limits.

---

## Tips and Best Practices

### Workflow Design

1. **Start simple.** Test with a basic Navigate > Extract flow before adding complexity.
2. **Use Wait steps for dynamic content.** Wait for a specific element rather than using a fixed delay when possible.
3. **Use variables.** Store extracted values with Extract to Variable or Set Variable so later steps can reference them via `{{variableName}}`.
4. **Name variables descriptively.** Use `productPrice` instead of `p1`.

### Writing Good Selectors

1. **Prefer IDs:** `#unique-id` is the most reliable selector.
2. **Use data attributes:** `[data-test='submit-btn']` is stable across style changes.
3. **Use classes for repeated elements:** `.product-card` for lists.
4. **Avoid fragile positional selectors:** `div:nth-child(3)` breaks when page structure changes.
5. **Test in DevTools:** Right-click an element > Inspect > right-click the highlighted HTML > Copy > Copy selector.

### Performance Optimization

1. **Minimize screenshots.** Only capture when you need visual verification.
2. **Prefer element waits over fixed delays.** A Wait step with a selector is faster and more reliable than a fixed duration.
3. **Extract only what you need.** Extracting fewer fields reduces execution time.
4. **Use loops instead of duplicate steps.** A single Loop step over `.product-card` replaces N identical Extract steps.

### Scheduling Best Practices

1. **Avoid overlapping schedules.** With 2 max concurrent workers, overlapping jobs will queue.
2. **Stagger jobs.** Spread scheduled jobs across different times.
3. **Monitor failure counts.** Jobs auto-pause after 5 consecutive failures.
4. **Review and adjust.** Update schedules based on actual usage patterns.

---

## Troubleshooting

See **TROUBLESHOOTING.md** for detailed solutions.

### Quick Fixes

**Workflow will not execute:**

- Verify the workflow status is set to Active.
- Confirm the target URL is accessible.
- Check that you have not exceeded your monthly execution limit.

**Step fails with "Selector not found":**

- Open the target page in a browser and use DevTools to verify the selector matches an element.
- The element may load dynamically — add a Wait step before the failing step.
- The page structure may have changed — update the selector.

**Execution times out:**

- The default timeout is 30 seconds per selector wait. If pages are slow, consider adding explicit Wait steps.
- Remove unnecessary steps to reduce total execution time.
- Check whether the target website is responding slowly.

**Scheduled job is not running:**

- Verify the job status is Active (not paused).
- Check that the cron expression is valid.
- Review the failure stats — the job may have been auto-paused after 5 consecutive failures.

**Variable substitution is not working:**

- Ensure you are using the `{{variableName}}` syntax (double curly braces).
- Verify the variable was set in a previous step (Set Variable or Extract to Variable).
- Variable names are case-sensitive.

---

## Limits and Quotas

| Resource | Free Tier Limit |
|----------|----------------|
| Workflows | 10 maximum |
| Executions | 50 per month |
| Storage | 1 GB total |
| Retention | 7 / 30 / 90 days (configurable) |
| Scheduled Jobs | Unlimited |
| Max execution time | 15 minutes per workflow |
| Max concurrent workers | 2 |
| Max loop iterations | 1000 (default 100) |
| Max download file size | 10 MB |

---

## Support

- **Documentation:** `docs/` folder in the repository.
- **API Reference:** `docs/API.md`
- **Troubleshooting:** `docs/TROUBLESHOOTING.md`
- **Deployment Guide:** `docs/DEPLOYMENT.md`

If you need help, check the troubleshooting guide first, then review execution logs for error details. Contact support with the execution ID for further assistance.

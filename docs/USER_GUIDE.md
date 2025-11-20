# AutoFlow Pro User Guide

## Getting Started

### 1. Create Account

1. Visit the AutoFlow Pro website
2. Click "Sign Up"
3. Enter email and password
4. Verify email (if required)
5. Log in to dashboard

### 2. Dashboard Overview

After login, you'll see:

- **Workflows**: Total workflows created
- **Executions**: Total executions this month
- **Success Rate**: Percentage of successful executions
- **Average Duration**: Average execution time

---

## Creating Your First Workflow

### Using Form Builder

1. Navigate to **Workflows** page
2. Click **"Create Workflow"** button
3. Enter workflow details:
   - **Name**: Descriptive name (e.g., "Daily Price Check")
   - **Description**: Optional details
   - **Status**: Draft, Active, or Archived
4. Click **"Add Step"** to add automation steps
5. Configure each step (see Step Types below)
6. Click **"Save Workflow"**

### Using Visual Builder

1. Navigate to **Workflows** page
2. Click on a workflow
3. Click the **Network icon** (Visual Builder)
4. **Drag** step types from left palette to canvas
5. **Click** node to configure in right panel
6. **Connect** nodes by dragging from output to input handle
7. Click **"Save"** in toolbar

---

## Step Types Guide

### Navigation Steps

**Navigate**

- Opens a URL in the browser
- Config: URL (must start with http:// or https://)
- Example: `https://example.com`

### Interaction Steps

**Click**

- Clicks an element on the page
- Config: CSS Selector
- Example: `button.submit`, `#login-btn`

**Fill**

- Fills a form field with text
- Config: Selector + Value
- Example: Selector: `input[name="email"]`, Value: `test@example.com`

**Hover**

- Hovers mouse over an element
- Config: Selector

**Scroll**

- Scrolls to element or coordinates
- Config: Selector OR x/y coordinates
- Example: Selector: `#footer` OR x: 0, y: 500

**Press Key**

- Presses a keyboard key
- Config: Key name
- Example: `Enter`, `Escape`, `Tab`

**Right Click**

- Right-clicks an element
- Config: Selector

**Double Click**

- Double-clicks an element
- Config: Selector

**Drag & Drop**

- Drags element to target
- Config: Source Selector + Target Selector

**Select Dropdown**

- Selects option from dropdown
- Config: Selector + Value/Label/Index

### Data Extraction Steps

**Extract**

- Extracts text or attributes from element(s)
- Config:
  - Selector
  - Field Name (variable name to store data)
  - Attribute (optional, e.g., "href", "src")
- Stores in: `extracted_data[field_name]`

**Extract to Variable**

- Same as Extract but stores in workflow variables
- Accessible in later steps via `${variableName}`

### Wait Steps

**Wait**

- Pauses execution
- Config: Duration (milliseconds) OR Selector
- Duration example: 5000 (5 seconds)
- Selector example: `.loading` (waits for element to appear)

### Screenshot Steps

**Screenshot**

- Captures screenshot
- Config: Selector (optional)
- If no selector: captures full page
- Stored in execution screenshots

### Variable Steps

**Set Variable**

- Creates or updates a variable
- Config: Variable Name + Value
- Example: `count` = `10`

**Extract to Variable**

- Extracts data and stores in variable
- Accessible via `${variableName}` in other steps

### Logic Steps

**Conditional**

- Executes steps based on condition
- Condition Types:
  - **Element Exists**: Checks if selector finds element
  - **Element Visible**: Checks if element is visible
  - **Text Contains**: Checks if element text contains string
  - **Value Equals**: Compares values (supports operators)
  - **Custom JavaScript**: Write custom condition

**Loop**

- Repeats steps multiple times
- Loop Types:
  - **Elements**: Iterates over all elements matching selector
  - **Count**: Repeats N times
- Loop variables available:
  - `${loopIndex}` - Current index (0-based)
  - `${loopIteration}` - Current iteration (1-based)
  - `${loopTotal}` - Total iterations
  - `${loopElementText}` - Text of current element
  - `${loopElementHTML}` - HTML of current element

### Storage Steps

**Download File**

- Downloads file from browser
- Config: Trigger method (click selector OR navigate URL)
- Stores in Supabase Storage

**Set Cookie**

- Sets browser cookie
- Config: Name + Value + Domain

**Get Cookie**

- Reads browser cookie
- Config: Cookie Name + Variable Name (optional)

**Set LocalStorage**

- Sets localStorage value
- Config: Key + Value

**Get LocalStorage**

- Reads localStorage value
- Config: Key + Variable Name (optional)

### Advanced Steps

**Execute JavaScript**

- Runs custom JavaScript in browser context
- Config: JavaScript code
- Has access to: `document`, `window`, workflow variables
- Example: `return document.title;`

---

## Executing Workflows

### Manual Execution

1. Go to **Workflows** page
2. Find your workflow
3. Click **"Execute"** button
4. Execution starts immediately
5. View real-time progress in **Executions** page

### Viewing Execution Results

1. Go to **Executions** page
2. Click on execution to view details
3. See:
   - **Status**: Queued, Running, Completed, Failed
   - **Logs**: Step-by-step execution logs
   - **Extracted Data**: Data collected during execution
   - **Screenshots**: Screenshots captured
   - **Duration**: Total execution time
   - **Error**: Error message (if failed)

### Real-Time Monitoring

- **Live Indicator**: Green pulsing dot shows live execution
- **Auto-Scroll**: Logs auto-scroll during execution
- **WebSocket**: Real-time updates without page refresh

---

## Scheduling Workflows

### Create Scheduled Job

1. Go to **Scheduled Jobs** page
2. Click **"Schedule Workflow"**
3. Select workflow from dropdown
4. Choose schedule:
   - **Presets**: Every minute, hourly, daily, weekly, monthly
   - **Custom**: Enter cron expression
5. Preview next run times
6. Click **"Create"**

### Cron Expression Examples

- `0 9 * * *` - Daily at 9:00 AM
- `0 */6 * * *` - Every 6 hours
- `0 9 * * 1` - Every Monday at 9:00 AM
- `0 9 1 * *` - First day of month at 9:00 AM
- `*/15 * * * *` - Every 15 minutes

### Managing Scheduled Jobs

- **Pause**: Click toggle to pause without deleting
- **Edit**: Click edit icon to change schedule
- **Delete**: Click trash icon to remove schedule
- **View History**: Click job card to see execution history

### Failure Monitoring

- **Warning**: Shows after 3 consecutive failures
- **Auto-Pause**: Job pauses after 5 consecutive failures
- **Resume**: Manually resume after fixing issue

---

## Analytics & Monitoring

### Dashboard Metrics

**Overview Cards**:

- Total workflows created
- Total executions (with trend)
- Success rate percentage
- Average execution time

**Execution Volume Chart**:

- Line chart showing executions over time
- Green: Successful executions
- Red: Failed executions

**Success Rate Chart**:

- Pie chart showing success vs failure ratio

**Top Workflows**:

- Bar chart of most-used workflows

**Resource Usage**:

- Workflows: 10 max on free tier
- Executions: 50 per month
- Storage: 1GB total

### Execution Trends

1. Go to **Analytics** page
2. Select time range (7, 14, 30, 90 days)
3. View trends over selected period
4. Identify peak usage times
5. Spot failure patterns

### Error Analysis

**Error Table** shows:

- Most common error messages
- Frequency of each error
- Last occurrence
- Affected workflows
- Click "View" to see failed execution

**Common Errors**:

- `Selector not found` - Element doesn't exist
- `Timeout waiting for element` - Element took too long
- `Navigation failed` - Website couldn't load
- `JavaScript execution failed` - Custom code error

### Performance Insights

**Slowest Workflows**:

- Identify workflows taking longest
- Optimize by reducing wait times
- Remove unnecessary steps

**High Failure Rates**:

- Workflows with >30% failure rate
- Investigate common failure points
- Update selectors if page changed

---

## Data Management

### Storage Usage

View storage breakdown:

- Execution logs
- Screenshots
- Downloaded files
- Archived data

### Data Retention Policy

**Settings** → **Retention Policy**:

- **7 days**: Minimal storage, frequent archival
- **30 days**: Recommended balance
- **90 days**: Extended history

**What Happens**:

- Executions older than retention period archived to R2
- Logs and data moved to cold storage
- Archived data still accessible (slower)

### Archival

**Automatic**: Runs daily at 2:00 AM
**Manual**: Analytics page → "Archive Old Executions"

**Archived Data**:

- Stored in Cloudflare R2
- Retrievable when needed
- Doesn't count toward active storage

---

## Tips & Best Practices

### Workflow Design

1. **Start Simple**: Test with basic navigate → extract flow
2. **Use Wait Steps**: Add waits for dynamic content
3. **Error Handling**: Add conditional steps for error cases
4. **Variable Names**: Use descriptive names (`productPrice` not `p1`)

### Selector Writing

1. **Prefer IDs**: `#unique-id` is most reliable
2. **Use Classes**: `.product-card` for repeated elements
3. **Avoid Indexes**: `div:nth-child(1)` breaks if page changes
4. **Test in DevTools**: Right-click → Inspect → Copy selector

### Performance Optimization

1. **Minimize Screenshots**: Only capture when needed
2. **Reduce Wait Times**: Use element waits instead of fixed delays
3. **Extract Selectively**: Only extract data you need
4. **Batch Operations**: Use loops instead of duplicate steps

### Scheduling Best Practices

1. **Avoid Peak Hours**: Schedule during off-peak times
2. **Stagger Jobs**: Don't run all jobs at same time
3. **Monitor Failures**: Check scheduled job stats regularly
4. **Update Schedules**: Adjust based on actual needs

---

## Troubleshooting

See **TROUBLESHOOTING.md** for detailed solutions.

**Quick Fixes**:

**Workflow Won't Execute**:

- Check workflow status (must be Active)
- Verify URL is accessible
- Check execution limit not exceeded

**Step Fails with "Selector not found"**:

- Inspect page to verify selector
- Element might load dynamically (add wait step)
- Page structure might have changed

**Execution Timeout**:

- Reduce wait durations
- Remove unnecessary steps
- Check target website performance

**Scheduled Job Not Running**:

- Verify job is Active
- Check cron expression is valid
- Review failure stats for auto-pause

---

## Limits & Quotas (Free Tier)

- **Workflows**: 10 maximum
- **Executions**: 50 per month
- **Storage**: 1GB total
- **Retention**: 7/30/90 days options
- **Scheduled Jobs**: Unlimited
- **Execution Time**: 15 minutes max per workflow

---

## Support

**Documentation**: docs/ folder in repository
**API Reference**: docs/API.md
**Troubleshooting**: docs/TROUBLESHOOTING.md
**Deployment Guide**: docs/DEPLOYMENT.md

**Need Help?**

- Check troubleshooting guide first
- Review execution logs for error details
- Contact support with execution ID for assistance

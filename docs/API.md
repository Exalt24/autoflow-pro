# AutoFlow Pro API Documentation

## Base URL

- **Development**: `http://localhost:4000/api`
- **Production**: `https://your-backend.onrender.com/api`

## Authentication

All API endpoints (except health checks) require authentication via Bearer token.

**Header Format**:

```
Authorization: Bearer <your-jwt-token>
```

---

## Workflows

### List Workflows

```http
GET /api/workflows?page=1&limit=10&search=&status=active
```

**Query Parameters**:

- `page` (optional): Page number, default 1
- `limit` (optional): Items per page, default 10, max 100
- `search` (optional): Search by workflow name
- `status` (optional): Filter by status (draft|active|archived)

**Response**:

```json
{
  "workflows": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "name": "My Workflow",
      "description": "Workflow description",
      "definition": {
        "steps": [...]
      },
      "status": "active",
      "created_at": "2025-01-15T10:00:00Z",
      "updated_at": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 50,
  "page": 1,
  "limit": 10,
  "totalPages": 5
}
```

### Get Workflow by ID

```http
GET /api/workflows/:id
```

**Response**: Single workflow object

### Create Workflow

```http
POST /api/workflows
Content-Type: application/json
```

**Body**:

```json
{
  "name": "My Workflow",
  "description": "Optional description",
  "status": "draft",
  "definition": {
    "steps": [
      {
        "id": "step-1",
        "type": "navigate",
        "config": {
          "url": "https://example.com"
        }
      }
    ]
  }
}
```

**Valid Step Types**:

- `navigate`, `click`, `fill`, `extract`, `wait`, `screenshot`, `scroll`, `hover`, `press_key`, `execute_js`
- `conditional`, `loop`, `set_variable`, `extract_to_variable`
- `download_file`, `drag_drop`, `set_cookie`, `get_cookie`
- `set_localstorage`, `get_localstorage`, `select_dropdown`, `right_click`, `double_click`

**Response**: Created workflow object

### Update Workflow

```http
PUT /api/workflows/:id
Content-Type: application/json
```

**Body**: Same as create (all fields optional)

### Delete Workflow

```http
DELETE /api/workflows/:id
```

**Response**: 204 No Content

### Duplicate Workflow

```http
POST /api/workflows/:id/duplicate
```

**Response**: New workflow object

### Execute Workflow

```http
POST /api/workflows/:id/execute
```

**Response**:

```json
{
  "jobId": "job-uuid",
  "executionId": "execution-uuid",
  "message": "Workflow execution queued"
}
```

---

## Executions

### List Executions

```http
GET /api/executions?page=1&limit=10&workflowId=&status=&startDate=&endDate=
```

**Query Parameters**:

- `page`, `limit`: Pagination
- `workflowId` (optional): Filter by workflow
- `status` (optional): Filter by status (queued|running|completed|failed)
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string

**Response**:

```json
{
  "executions": [
    {
      "id": "uuid",
      "workflow_id": "uuid",
      "user_id": "uuid",
      "status": "completed",
      "started_at": "2025-01-15T10:00:00Z",
      "completed_at": "2025-01-15T10:05:00Z",
      "duration": 300000,
      "logs": [...],
      "extracted_data": {...},
      "error_message": null
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 10,
  "totalPages": 10
}
```

### Get Execution by ID

```http
GET /api/executions/:id
```

### Get Execution Logs

```http
GET /api/executions/:id/logs?page=1&limit=50
```

**Response**:

```json
{
  "logs": [
    {
      "timestamp": "2025-01-15T10:00:00Z",
      "level": "info",
      "message": "Step completed",
      "step_id": "step-1"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 50,
  "totalPages": 3
}
```

### Delete Execution

```http
DELETE /api/executions/:id
```

---

## Analytics

### Get User Statistics

```http
GET /api/analytics/stats
```

**Response**:

```json
{
  "totalWorkflows": 10,
  "totalExecutions": 500,
  "successRate": 92.5,
  "averageDuration": 45000,
  "failedExecutions": 38,
  "activeWorkflows": 7
}
```

### Get Execution Trends

```http
GET /api/analytics/trends?days=7
```

**Response**:

```json
{
  "trends": [
    {
      "date": "2025-01-15",
      "total": 50,
      "successful": 46,
      "failed": 4
    }
  ]
}
```

### Get Top Workflows

```http
GET /api/analytics/top-workflows?limit=10
```

### Get Usage Quota

```http
GET /api/analytics/usage
```

**Response**:

```json
{
  "workflowsCount": 8,
  "executionsCount": 45,
  "executionsLimit": 50,
  "storageUsed": 524288000
}
```

### Get Slowest Workflows

```http
GET /api/analytics/slowest-workflows?limit=10
```

### Get Failed Workflows

```http
GET /api/analytics/failed-workflows?limit=10
```

### Get Error Analysis

```http
GET /api/analytics/errors?limit=10
```

### Get Resource Usage

```http
GET /api/analytics/resources
```

### Get Retention Policy

```http
GET /api/analytics/retention-policy
```

**Response**:

```json
{
  "retentionDays": 30
}
```

### Update Retention Policy

```http
PUT /api/analytics/retention-policy
Content-Type: application/json
```

**Body**:

```json
{
  "retentionDays": 90
}
```

**Valid Values**: 7, 30, 90

---

## Scheduled Jobs

### List Scheduled Jobs

```http
GET /api/scheduled-jobs?page=1&limit=10&workflowId=&isActive=true
```

**Response**:

```json
{
  "scheduledJobs": [
    {
      "id": "uuid",
      "workflow_id": "uuid",
      "user_id": "uuid",
      "cron_schedule": "0 9 * * *",
      "next_run_at": "2025-01-16T09:00:00Z",
      "last_run_at": "2025-01-15T09:00:00Z",
      "is_active": true,
      "created_at": "2025-01-10T10:00:00Z",
      "updated_at": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

### Create Scheduled Job

```http
POST /api/scheduled-jobs
Content-Type: application/json
```

**Body**:

```json
{
  "workflowId": "uuid",
  "cronSchedule": "0 9 * * *",
  "isActive": true
}
```

**Cron Format**: `minute hour day month weekday`

- Example: `0 9 * * *` = Daily at 9:00 AM
- Example: `*/15 * * * *` = Every 15 minutes

### Update Scheduled Job

```http
PUT /api/scheduled-jobs/:id
Content-Type: application/json
```

**Body**:

```json
{
  "cronSchedule": "0 10 * * *",
  "isActive": false
}
```

### Delete Scheduled Job

```http
DELETE /api/scheduled-jobs/:id
```

### Get Next Run Times

```http
GET /api/scheduled-jobs/:id/next-runs?count=5
```

**Response**:

```json
{
  "cronSchedule": "0 9 * * *",
  "nextRuns": [
    "2025-01-16T09:00:00Z",
    "2025-01-17T09:00:00Z",
    "2025-01-18T09:00:00Z",
    "2025-01-19T09:00:00Z",
    "2025-01-20T09:00:00Z"
  ]
}
```

### Get Job Execution History

```http
GET /api/scheduled-jobs/:id/history?limit=20
```

### Get Job Failure Statistics

```http
GET /api/scheduled-jobs/:id/stats
```

**Response**:

```json
{
  "consecutiveFailures": 2,
  "lastFailureAt": "2025-01-15T09:00:00Z",
  "recentFailureRate": 15.5,
  "totalRecentExecutions": 20,
  "isPaused": false
}
```

---

## Archival

### Get Archival Statistics

```http
GET /api/archival/stats
```

**Response**:

```json
{
  "totalExecutions": 500,
  "archivedExecutions": 250,
  "activeExecutions": 250,
  "eligibleForArchival": 30,
  "retentionDays": 30
}
```

### Archive Old Executions

```http
POST /api/archival/archive
```

**Response**:

```json
{
  "total": 30,
  "successful": 28,
  "failed": 2
}
```

### Get Eligible Executions

```http
GET /api/archival/eligible
```

### Restore Archived Execution

```http
POST /api/archival/restore/:id
```

---

## User

### Get User Profile

```http
GET /api/user/profile
```

**Response**:

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "created_at": "2025-01-01T00:00:00Z"
}
```

---

## Health Checks

### Basic Health

```http
GET /health
```

**Response**:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:00:00Z",
  "uptime": "2d 5h 30m",
  "environment": "production"
}
```

### Detailed Health

```http
GET /health/detailed
```

### System Metrics

```http
GET /health/metrics
```

### Readiness Check

```http
GET /health/ready
```

### Liveness Check

```http
GET /health/live
```

---

## Error Responses

**400 Bad Request**:

```json
{
  "error": "Validation Error",
  "message": "Workflow name is required"
}
```

**401 Unauthorized**:

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing authentication token"
}
```

**404 Not Found**:

```json
{
  "error": "Not Found",
  "message": "Workflow not found"
}
```

**429 Too Many Requests**:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Please try again later."
}
```

**500 Internal Server Error**:

```json
{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred"
}
```

---

## Rate Limiting

- **Limit**: 100 requests per 15 minutes per IP
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## WebSocket Events

**Connection**:

```javascript
const socket = io("https://your-backend.onrender.com", {
  auth: { token: "your-jwt-token" },
});
```

**Subscribe to Execution**:

```javascript
socket.emit("subscribe:execution", { executionId: "uuid" });
```

**Events**:

- `execution:status` - Status updates
- `execution:log` - Individual log entries
- `execution:logs:batch` - Batched logs (every 1 second)
- `execution:completed` - Execution finished
- `execution:failed` - Execution failed

**Unsubscribe**:

```javascript
socket.emit("unsubscribe:execution", { executionId: "uuid" });
```

# Health Check Endpoints

## Overview

AutoFlow Pro provides multiple health check endpoints for monitoring and orchestration.

---

## GET /health

**Purpose**: Basic health check for uptime monitoring

**Response Codes**:

- `200`: Service is healthy
- `503`: Service is unhealthy

**Response Body**:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": "2d 5h 30m",
  "environment": "production"
}
```

**Use Case**: UptimeRobot monitoring, basic health checks

---

## GET /health/detailed

**Purpose**: Comprehensive health status with all component checks

**Response Codes**:

- `200`: Healthy or degraded (still operational)
- `503`: Unhealthy (critical failure)

**Response Body**:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 180000,
  "checks": {
    "database": {
      "status": "pass",
      "responseTime": 45
    },
    "queue": {
      "status": "pass",
      "active": 2,
      "waiting": 5
    },
    "redis": {
      "status": "pass",
      "commandsPerMinute": 150
    },
    "memory": {
      "status": "pass",
      "percentage": 65
    }
  }
}
```

**Status Values**:

- `healthy`: All checks pass
- `degraded`: Some warnings but operational
- `unhealthy`: Critical failures

**Check Status**:

- `pass`: Component operational
- `warn`: Warning threshold exceeded
- `fail`: Component failed

**Use Case**: Detailed monitoring dashboards, debugging

---

## GET /health/metrics

**Purpose**: System metrics for performance monitoring

**Response Body**:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": "2d 5h 30m",
  "memory": {
    "used": "145.67 MB",
    "total": "512.00 MB",
    "percentage": "28%"
  },
  "queue": {
    "waiting": 5,
    "active": 2,
    "completed": 1247,
    "failed": 23,
    "delayed": 0
  },
  "database": {
    "connected": true,
    "responseTime": "45ms"
  },
  "redis": {
    "connected": true,
    "commandsPerMinute": 150
  }
}
```

**Use Case**: Performance monitoring, capacity planning

---

## GET /health/ready

**Purpose**: Kubernetes-style readiness probe

**Response Codes**:

- `200`: Service ready to accept traffic
- `503`: Service not ready (dependencies unavailable)

**Response Body**:

```json
{
  "ready": true
}
```

**Ready Conditions**:

- Database connected
- Redis connected
- Queue operational

**Use Case**: Load balancer readiness checks, container orchestration

---

## GET /health/live

**Purpose**: Kubernetes-style liveness probe

**Response Body**:

```json
{
  "alive": true
}
```

**Always Returns**: 200 OK (server is running)

**Use Case**: Container liveness checks, simple ping

---

## Monitoring Strategy

### Production Monitoring

1. **UptimeRobot**: Monitor `/health` every 5 minutes
2. **Alerts**: Email/Slack on downtime
3. **Dashboard**: Display `/health/metrics` for ops team

### Container Orchestration

- **Readiness Probe**: `/health/ready` (determines traffic routing)
- **Liveness Probe**: `/health/live` (determines container restart)

### Development Monitoring

- **Local Health**: `http://localhost:4000/health/detailed`
- **Metrics Dashboard**: `http://localhost:4000/health/metrics`

---

## Testing

**Test Basic Health**:

```powershell
curl http://localhost:4000/health
```

**Test Detailed Health**:

```powershell
curl http://localhost:4000/health/detailed
```

**Test Metrics**:

```powershell
curl http://localhost:4000/health/metrics
```

**Test Readiness**:

```powershell
curl http://localhost:4000/health/ready
```

**Test Liveness**:

```powershell
curl http://localhost:4000/health/live
```

---

## Response Time Expectations

- `/health`: < 100ms
- `/health/detailed`: < 200ms
- `/health/metrics`: < 200ms
- `/health/ready`: < 100ms
- `/health/live`: < 50ms

---

## Alert Thresholds

**Memory Usage**:

- Warning: 75%
- Critical: 90%

**Database Response Time**:

- Warning: > 500ms
- Critical: > 2000ms

**Queue Depth**:

- Warning: > 100 waiting jobs
- Critical: > 500 waiting jobs

**Uptime**:

- Target: 99.9% monthly
- Alert: < 99% over 24 hours

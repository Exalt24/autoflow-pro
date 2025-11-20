# UptimeRobot Setup for AutoFlow Pro

## Overview

UptimeRobot monitors your backend API and prevents Render free tier spin-down by pinging every 5 minutes.

## Setup Steps

### 1. Create UptimeRobot Account

- Go to https://uptimerobot.com
- Sign up for free account (50 monitors included)

### 2. Add New Monitor

**Monitor Settings:**

- Monitor Type: HTTP(s)
- Friendly Name: AutoFlow Pro API
- URL: `https://your-backend.onrender.com/health`
- Monitoring Interval: 5 minutes
- Monitor Timeout: 30 seconds

**Expected Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": "2d 5h 30m",
  "environment": "production"
}
```

### 3. Configure Alerts

**Alert Contacts:**

- Add your email address
- Optional: Add SMS (if available in your region)
- Optional: Slack webhook for team notifications

**Alert When:**

- Monitor goes DOWN (status code != 200)
- Send alert after: 2 minutes down
- Send recovery notification: Yes

### 4. Additional Monitors (Optional)

**Ready Check:**

- URL: `https://your-backend.onrender.com/health/ready`
- Checks if all dependencies are ready

**Metrics Monitor:**

- URL: `https://your-backend.onrender.com/health/metrics`
- Tracks system metrics over time

**Frontend Monitor:**

- Monitor Type: HTTP(s)
- URL: `https://your-frontend.vercel.app`
- Checks if frontend is accessible

### 5. Status Page (Optional)

**Create Public Status Page:**

1. Go to "Status Pages" in UptimeRobot
2. Click "Add New Status Page"
3. Select monitors to include
4. Customize design
5. Get public URL: `https://stats.uptimerobot.com/your-page-id`
6. Share with users or embed on website

### 6. Verify Setup

After setup, check:

- [ ] Monitor shows "Up" status
- [ ] Response time displayed (should be < 500ms)
- [ ] Uptime percentage tracking started
- [ ] Alert email received (test by stopping server)

## Benefits of 5-Minute Interval

1. **Prevents Render Spin-Down**: Keeps free tier active
2. **Quick Issue Detection**: 5 minutes max before alert
3. **Free Tier Compatible**: 50 monitors = plenty of room

## Expected Metrics

- **Uptime**: Should be 99%+ after first week
- **Response Time**: 100-500ms typical from Singapore
- **Downtime Events**: Should be zero or near-zero

## Troubleshooting

**Monitor shows DOWN:**

1. Check Render dashboard - is service running?
2. Visit URL directly in browser
3. Check Render logs for errors
4. Verify environment variables set correctly

**High Response Times (>1000ms):**

1. Check Render region (should be Singapore)
2. Check database query performance
3. Check Redis connection
4. Review application logs

## Cost

- **Free Tier**: 50 monitors, 5-minute interval
- **Pro Plan**: $7/month if you need more monitors or 1-minute intervals

## Integration with Render

Render free tier spins down after 15 minutes of inactivity. UptimeRobot pings every 5 minutes, ensuring:

- Server stays active
- No cold start delays for users
- Consistent uptime

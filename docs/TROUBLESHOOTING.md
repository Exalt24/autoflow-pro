# AutoFlow Pro Troubleshooting Guide

## Development Issues

### Server Won't Start

**Error**: `Cannot find module '@fastify/helmet'`

```powershell
cd backend
npm install
```

**Error**: `Port 4000 already in use`

```powershell
# Find and kill process on port 4000
netstat -ano | findstr :4000
taskkill /PID <process_id> /F

# Or change port in .env
PORT=4001
```

**Error**: `SUPABASE_URL is not defined`

```powershell
# Check .env file exists
cd backend
Test-Path .env

# Copy from example if missing
copy .env.example .env
# Then fill in actual values
```

### Frontend Build Errors

**Error**: `Module not found: Can't resolve 'dompurify'`

```powershell
cd frontend
npm install dompurify @types/dompurify
```

**Error**: `Type error: Cannot find name 'process'`

- This is normal in Next.js 15
- Add to `next.config.ts`:

```typescript
webpack: (config, { isServer }) => {
  if (!isServer) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      process: false,
    };
  }
  return config;
};
```

**Error**: `Hydration failed because initial UI doesn't match`

- Check for client-only code in server components
- Use `'use client'` directive at top of file
- Wrap in `useEffect` for browser-only operations

### Database Connection

**Error**: `Failed to connect to Supabase`

- Verify `SUPABASE_URL` format: `https://xxx.supabase.co`
- Check `SUPABASE_SERVICE_KEY` is service_role, not anon
- Test connection: `npm run test:connection`

**Error**: `Row Level Security policy violation`

- User not authenticated
- Check Authorization header format: `Bearer <token>`
- Verify token not expired
- Test with service_role key (bypasses RLS)

### Redis Connection

**Error**: `Redis connection failed`

- Verify `UPSTASH_REDIS_URL` format: `rediss://default:password@host:6379`
- Check Upstash dashboard shows database active
- Test: `npm run test:queue`

**Error**: `ERR max number of clients reached`

- Restart Upstash database (free tier: 10K commands/day)
- Check for connection leaks in code
- Verify `queueService.close()` called on shutdown

---

## Workflow Execution Issues

### Selector Not Found

**Error**: `Selector not found: .my-element`

**Causes**:

1. Element doesn't exist on page
2. Element loads dynamically after page load
3. Selector syntax incorrect

**Solutions**:

```
1. Inspect page to verify element exists
   - Right-click → Inspect
   - Search for element in Elements tab

2. Add wait step before click/fill
   - Wait for selector: .my-element
   - Duration: 5000ms (5 seconds)

3. Try alternative selectors:
   - ID: #my-id (most reliable)
   - Class: .my-class
   - Attribute: [data-test="my-element"]
   - XPath: //button[text()="Click Me"]
```

### Navigation Timeout

**Error**: `Navigation timeout exceeded`

**Causes**:

1. Website slow to load
2. URL incorrect or blocked
3. Network issues

**Solutions**:

```
1. Verify URL is accessible
   - Test in browser manually
   - Check for typos in URL

2. Increase timeout (future feature)
   - Default: 30 seconds
   - Workaround: Add wait step after navigate

3. Check website status
   - Use https://downforeveryoneorjustme.com
```

### JavaScript Execution Failed

**Error**: `JavaScript execution failed: X is not defined`

**Causes**:

1. Variable not in scope
2. Syntax error in JavaScript
3. DOM not ready

**Solutions**:

```
1. Check variable names
   - Workflow variables: use ${variableName}
   - Browser variables: use window.variableName

2. Test JavaScript in browser console
   - F12 → Console tab
   - Paste your code
   - Fix errors

3. Add wait for page load
   - Wait for selector: body
```

### Loop Not Iterating

**Issue**: Loop executes only once or not at all

**Causes**:

1. Selector matches no elements
2. Elements load after loop starts
3. Loop max iterations reached

**Solutions**:

```
1. Verify selector matches multiple elements
   - Open browser console
   - Run: document.querySelectorAll('your-selector')
   - Should return array of elements

2. Add wait before loop
   - Wait for selector to ensure elements loaded

3. Check loop configuration
   - Loop type: Elements
   - Selector: .item (matches multiple)
   - Max iterations: 100 (default)
```

---

## Scheduled Jobs Issues

### Job Not Running

**Issue**: Scheduled job shows "Active" but doesn't execute

**Causes**:

1. Cron expression invalid
2. Next run time in past
3. Server restart cleared schedule

**Solutions**:

```
1. Validate cron expression
   - Use https://crontab.guru
   - Test with simple expression: * * * * * (every minute)

2. Edit and save job
   - Recalculates next run time
   - Resyncs with BullMQ

3. Check backend logs
   - Render dashboard → Logs
   - Search for "Scheduled job" entries
```

### Auto-Paused After Failures

**Issue**: Job shows "Paused" with failure warning

**Cause**: 5 consecutive execution failures

**Solutions**:

```
1. Check failure stats
   - View job → Failure Statistics
   - Identify error pattern

2. Fix workflow issue
   - Update selectors
   - Fix navigation URLs
   - Adjust wait times

3. Resume job
   - Click "Resume" button
   - Monitor next few executions
```

---

## WebSocket Issues

### Real-Time Updates Not Working

**Issue**: Logs don't stream during execution

**Causes**:

1. WebSocket connection failed
2. CORS blocking connection
3. Firewall blocking WebSocket

**Solutions**:

```
1. Check browser console for errors
   - F12 → Console tab
   - Look for WebSocket errors

2. Verify NEXT_PUBLIC_WS_URL
   - Should match backend URL
   - No /api suffix
   - Example: https://backend.onrender.com

3. Test WebSocket connection
   - Visit execution detail page
   - Look for green "Live" indicator
   - If missing, connection failed
```

### Connection Disconnects Frequently

**Issue**: WebSocket disconnects every few seconds

**Causes**:

1. Network instability
2. Backend restarting
3. Idle timeout

**Solutions**:

```
1. Check network connection
   - Test with ping to backend
   - Check for packet loss

2. Monitor backend uptime
   - UptimeRobot should prevent spin-down
   - Check Render logs for restarts

3. Reconnection automatic
   - Frontend retries with exponential backoff
   - Max delay: 30 seconds
```

---

## Production Issues

### Render Service Spinning Down

**Issue**: First request takes 30+ seconds

**Cause**: Free tier spins down after 15 minutes inactive

**Solutions**:

```
1. Set up UptimeRobot (REQUIRED)
   - Monitor /health endpoint
   - 5-minute interval
   - Keeps service active

2. Verify monitor working
   - Check UptimeRobot dashboard
   - Should show 99%+ uptime
   - Response time < 500ms
```

### Vercel Build Failed

**Error**: `Build failed with exit code 1`

**Common Causes**:

```
1. TypeScript errors
   - Check build logs for specific errors
   - Run locally: npm run build
   - Fix type errors

2. Missing environment variables
   - Verify all NEXT_PUBLIC_* vars set
   - Check Vercel dashboard → Settings → Environment Variables

3. Import errors
   - Check file paths are correct
   - Verify all imports exist
```

### Database Query Slow

**Issue**: API endpoints taking >2 seconds

**Causes**:

1. Missing indexes
2. Large result sets
3. N+1 query problem

**Solutions**:

```
1. Check Supabase Dashboard
   - Database → Performance
   - Identify slow queries

2. Verify indexes created
   - Run initial_schema.sql again
   - Creates performance indexes

3. Use pagination
   - Always set limit parameter
   - Default: 10, Max: 100
```

### Storage Quota Exceeded

**Error**: `Storage limit exceeded`

**Cause**: Too many screenshots or large extracted data

**Solutions**:

```
1. Run manual archival
   - Analytics → Archive Old Executions
   - Moves data to R2

2. Adjust retention policy
   - Settings → Retention Policy
   - Change from 90 to 30 or 7 days

3. Optimize workflows
   - Reduce screenshot frequency
   - Extract only needed data
   - Delete old test executions
```

---

## Authentication Issues

### Cannot Sign Up

**Error**: `Email already registered`

- Check Supabase dashboard for existing user
- Use password reset to access account

**Error**: `Invalid email format`

- Verify email format correct
- No spaces before/after

### Cannot Log In

**Error**: `Invalid login credentials`

**Solutions**:

```
1. Check email/password correct
   - Use password reset if forgotten

2. Verify email confirmed (if required)
   - Check inbox for confirmation email
   - Resend confirmation from login page

3. Check Supabase Auth settings
   - Authentication → Providers
   - Verify Email/Password enabled
```

### Token Expired

**Error**: `jwt expired` or `401 Unauthorized`

**Solution**: Log out and log back in

- Token expires after configurable time (default: 1 hour)
- Frontend should auto-refresh (if implemented)

---

## Browser Automation Issues

### Screenshot Empty or Black

**Causes**:

1. Page not fully loaded
2. Canvas/video elements
3. Viewport too small

**Solutions**:

```
1. Add wait before screenshot
   - Wait for main content selector
   - Wait duration: 3000ms

2. Specific element screenshot
   - Capture specific div instead of full page
   - Selector: .main-content

3. Check viewport settings
   - Default: 1280x720
   - May need adjustment for responsive sites
```

### File Download Not Working

**Issue**: Download step completes but no file stored

**Causes**:

1. Click doesn't trigger download
2. File requires authentication
3. Storage quota exceeded

**Solutions**:

```
1. Verify download trigger
   - Test manually in browser
   - Check if popup blockers interfere

2. Add wait for download
   - Set waitForDownload: true
   - Timeout: 30 seconds

3. Check Supabase Storage
   - Storage → Buckets → workflow-attachments
   - Verify file appears
```

---

## Performance Issues

### High Memory Usage

**Warning**: Memory usage >90%

**Solutions**:

```
1. Check concurrent executions
   - Default max: 2 browsers
   - Reduce if memory issues persist

2. Clear browser resources
   - Implement browser pooling
   - Close pages after use

3. Monitor Render metrics
   - Dashboard → Metrics
   - Consider upgrade if consistently high
```

### Queue Backlog

**Issue**: >100 jobs waiting in queue

**Causes**:

1. Worker offline
2. Executions timing out
3. Rate limit hit

**Solutions**:

```
1. Check worker status
   - Backend logs should show "Queue worker initialized"
   - Restart service if needed

2. Review failed jobs
   - /health/metrics → queue.failed
   - Identify common failure cause

3. Pause scheduled jobs temporarily
   - Stop new jobs from queuing
   - Clear backlog
   - Resume gradually
```

---

## Getting Help

### Gather Debug Information

Before reporting issues, collect:

```
1. Execution ID (from Executions page)
2. Error message (exact text)
3. Browser console errors (F12 → Console)
4. Backend logs (Render dashboard)
5. Steps to reproduce
6. Expected vs actual behavior
```

### Check Logs

**Backend Logs** (Render):

1. Go to Render dashboard
2. Click service → Logs
3. Filter by time period
4. Search for error messages

**Frontend Errors** (Browser):

1. Press F12
2. Console tab
3. Look for red errors
4. Network tab for failed requests

### Test in Isolation

**Simplify Workflow**:

1. Create minimal test workflow
2. Single navigate step
3. Execute and verify
4. Add steps one at a time
5. Identify failing step

### Community Resources

- GitHub Issues: Check existing issues
- Documentation: docs/ folder
- API Reference: docs/API.md
- Deployment Guide: docs/DEPLOYMENT.md

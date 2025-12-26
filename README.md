# Facebook CDN URL Updater

Automatically updates expired Facebook CDN URLs in Supabase database every 24 hours.

## 🎯 Features

- ✅ Checks video URLs every 24 hours
- ✅ Updates expired URLs automatically  
- ✅ Queue system for large datasets
- ✅ Telegram notifications (optional)
- ✅ Works with existing table structure (no changes needed)

## 📊 Table Structure

Your existing tables remain unchanged:

### Episodes Table
- `id` - Episode ID
- `title` - Episode title
- `video_url` - CDN URL (will be updated)
- `facebook_video_id` - Facebook video ID (used to fetch new URL)

### Movies Table
- `id` - Movie ID
- `title` - Movie title
- `videoUrl` - CDN URL (will be updated)
- `facebookVideoId` - Facebook video ID (used to fetch new URL)

## 🚀 Quick Setup

### 1. Create Queue Table in Supabase

Run this SQL in your Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS url_update_queue (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  facebook_video_id TEXT NOT NULL,
  old_url TEXT,
  video_title TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_queue_status ON url_update_queue(status);
CREATE INDEX idx_queue_created ON url_update_queue(created_at);
```

### 2. Deploy to Render

1. Push this code to GitHub
2. Go to [render.com](https://render.com)
3. Create new Web Service
4. Connect your GitHub repository
5. Use these settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free

### 3. Set Environment Variables in Render

| Variable | Description | Required |
|----------|-------------|----------|
| `SUPABASE_URL` | Your Supabase project URL | ✅ Yes |
| `SUPABASE_KEY` | Your Supabase anon key | ✅ Yes |
| `FACEBOOK_ACCESS_TOKEN` | Facebook Page access token | ✅ Yes |
| `SECRET_KEY` | Random secret key for security | ✅ Yes |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | ❌ Optional |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID | ❌ Optional |

**Generate SECRET_KEY:**
```bash
openssl rand -hex 32
```

### 4. Set Up Cron Job

Use [cron-job.org](https://cron-job.org) (free):

1. Create account
2. Add new cron job:
   - **URL**: `https://your-app.onrender.com/update-urls`
   - **Schedule**: Daily at 2 AM (or your preferred time)
   - **Method**: POST
   - **Headers**:
     - `x-secret-key: YOUR_SECRET_KEY`
     - `Content-Type: application/json`

## 📡 API Endpoints

### Health Check
```bash
GET /
```
Returns service status

### Trigger Update
```bash
POST /update-urls
Headers: x-secret-key: YOUR_SECRET_KEY
```
Triggers 24-hour URL update process

### Queue Status
```bash
GET /status
```
Returns current queue statistics

### Test Single Video
```bash
GET /test-video/:videoId
```
Tests fetching URL for a specific Facebook video ID

## 🔧 Testing

### Test health:
```bash
curl https://your-app.onrender.com/
```

### Test update:
```bash
curl -X POST https://your-app.onrender.com/update-urls \
  -H "x-secret-key: YOUR_SECRET_KEY"
```

### Test specific video:
```bash
curl https://your-app.onrender.com/test-video/1585542386136921
```

## 📈 How It Works

1. **Runs every 24 hours** via external cron job
2. **Processes queue** from previous runs first
3. **Checks all videos** in episodes and movies tables
4. **Tests each URL** to see if expired
5. **Updates only expired URLs** with fresh Facebook CDN links
6. **Queues excess work** if API limit (190 calls) is reached
7. **Sends Telegram report** with detailed statistics

## 🛡️ Safety Features

- ✅ No changes to your existing tables
- ✅ Only updates expired URLs (doesn't touch working ones)
- ✅ API rate limit protection
- ✅ Queue system prevents data loss
- ✅ Detailed error tracking
- ✅ Comprehensive logging

## 🔍 Monitoring

### Check Render Logs
Go to your Render dashboard → Logs tab

### Check Queue Status
Visit: `https://your-app.onrender.com/status`

### Telegram Reports
If configured, you'll receive daily reports with:
- Total URLs checked
- URLs already valid (no update needed)
- URLs successfully updated
- Failed updates with reasons
- API usage statistics

## ❓ Troubleshooting

### URLs not updating?
1. Check Render logs for errors
2. Verify Facebook token: `/test-video/VIDEO_ID`
3. Confirm Supabase credentials
4. Check cron job is running

### "Unauthorized" error?
- Verify `x-secret-key` header matches `SECRET_KEY` environment variable

### Service sleeping?
- Free tier sleeps after 15 minutes
- Cron job wakes it automatically
- Or use UptimeRobot to ping every 14 minutes

## 📞 Support

Check these in order:
1. Render logs
2. Test individual endpoints
3. Verify environment variables
4. Test Facebook token validity
5. Check Supabase table structure

## 📄 License

MIT

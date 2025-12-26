require('dotenv').config();
const express = require('express');
const { processUrlUpdates, getQueueStatus, testFacebookVideo } = require('./urlUpdater');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    service: 'Facebook CDN URL Updater',
    timestamp: new Date().toISOString(),
    message: 'Service is healthy. Use POST /update-urls to trigger update.'
  });
});

// Main update endpoint (triggered by external cron job every 24 hours)
app.post('/update-urls', async (req, res) => {
  const secretKey = req.headers['x-secret-key'];
  if (secretKey !== process.env.SECRET_KEY) {
    console.log('Unauthorized access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('URL update triggered at:', new Date().toISOString());

  res.json({ 
    status: 'started', 
    message: 'URL update process initiated. This runs every 24 hours.',
    timestamp: new Date().toISOString()
  });

  try {
    await processUrlUpdates();
  } catch (error) {
    console.error('Error in background process:', error);
  }
});

// Get queue status endpoint
app.get('/status', async (req, res) => {
  try {
    const status = await getQueueStatus();
    res.json({
      ...status,
      message: 'Queue status retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Manual test endpoint for debugging specific video
app.get('/test-video/:videoId', async (req, res) => {
  try {
    const result = await testFacebookVideo(req.params.videoId);
    res.json({
      videoId: req.params.videoId,
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      videoId: req.params.videoId,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: {
      healthCheck: 'GET /',
      updateUrls: 'POST /update-urls (requires x-secret-key header)',
      status: 'GET /status',
      testVideo: 'GET /test-video/:videoId'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/`);
  console.log(`Update endpoint: POST http://localhost:${PORT}/update-urls`);
  console.log(`Configured for 24-hour update cycle`);
  console.log(`========================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

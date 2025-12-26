const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const FB_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const MAX_API_CALLS = 190;

let stats = {
  totalChecked: 0,
  alreadyValid: 0,
  updated: 0,
  failed: 0,
  queued: 0,
  apiCallsUsed: 0,
  startTime: null,
  episodesUpdated: 0,
  moviesUpdated: 0,
  failures: { notFound: [], permissionDenied: [], apiError: [] }
};

async function sendTelegram(message) {
  if (!TG_TOKEN || !TG_CHAT_ID) {
    console.log('Telegram not configured, skipping notification');
    return;
  }
  
  try {
    await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('Telegram notification sent successfully');
  } catch (error) {
    console.error('Telegram error:', error.message);
  }
}

async function isUrlValid(url) {
  if (!url || url === 'NULL' || url === '') return false;
  
  try {
    const response = await axios.head(url, { 
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: (status) => status === 200
    });
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

async function getFacebookVideoUrl(videoId) {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v18.0/${videoId}`,
      {
        params: { fields: 'source', access_token: FB_TOKEN },
        timeout: 10000
      }
    );
    
    stats.apiCallsUsed++;
    
    if (response.data && response.data.source) {
      return { success: true, url: response.data.source };
    }
    
    return { success: false, error: 'no_source', message: 'No source URL found' };
    
  } catch (error) {
    stats.apiCallsUsed++;
    
    if (error.response?.data?.error) {
      const code = error.response.data.error.code;
      const message = error.response.data.error.message || '';
      
      if (code === 100 || message.toLowerCase().includes('does not exist')) {
        return { success: false, error: 'not_found', message: 'Video not found' };
      }
      
      if (code === 200 || code === 10 || message.toLowerCase().includes('permission')) {
        return { success: false, error: 'permission_denied', message: 'No permission' };
      }
      
      if (code === 4 || code === 17 || message.toLowerCase().includes('rate limit')) {
        return { success: false, error: 'rate_limit', message: 'Rate limit reached' };
      }
      
      return { success: false, error: 'api_error', message: `API error: ${message}` };
    }
    
    return { success: false, error: 'network_error', message: error.message };
  }
}

async function addToQueue(tableName, rowId, videoId, oldUrl, title = null) {
  try {
    const { error } = await supabase.from('url_update_queue').insert({
      table_name: tableName,
      row_id: rowId,
      facebook_video_id: videoId,
      old_url: oldUrl,
      video_title: title,
      status: 'pending'
    });
    
    if (error) {
      console.error('Error adding to queue:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Exception adding to queue:', error);
    return false;
  }
}

async function markQueueProcessed(queueId, status, errorMsg = null) {
  try {
    await supabase.from('url_update_queue').update({
      status: status,
      processed_at: new Date().toISOString(),
      error_message: errorMsg
    }).eq('id', queueId);
  } catch (error) {
    console.error('Exception updating queue:', error);
  }
}

async function updateVideoUrl(tableName, rowId, newUrl) {
  try {
    let updateData = {};
    
    if (tableName === 'episodes') {
      updateData = { video_url: newUrl };
    } else if (tableName === 'movies') {
      updateData = { videoUrl: newUrl };
    } else {
      console.error(`Unknown table: ${tableName}`);
      return false;
    }
    
    const { error } = await supabase.from(tableName).update(updateData).eq('id', rowId);
    
    if (error) {
      console.error(`Error updating ${tableName}:`, error);
      return false;
    }
    
    if (tableName === 'episodes') {
      stats.episodesUpdated++;
    } else if (tableName === 'movies') {
      stats.moviesUpdated++;
    }
    
    return true;
  } catch (error) {
    console.error(`Exception updating ${tableName}:`, error);
    return false;
  }
}

async function processQueue() {
  console.log('Checking for queued items from previous runs...');
  
  const { data: queueItems, error } = await supabase
    .from('url_update_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_API_CALLS);

  if (error || !queueItems || queueItems.length === 0) {
    console.log('No queued items to process');
    return [];
  }

  console.log(`Processing ${queueItems.length} queued items...`);

  for (const item of queueItems) {
    if (stats.apiCallsUsed >= MAX_API_CALLS) {
      console.log('API limit reached, stopping queue processing');
      break;
    }

    console.log(`[Queue] Processing: ${item.video_title || item.facebook_video_id}`);
    const result = await getFacebookVideoUrl(item.facebook_video_id);

    if (result.success) {
      const updated = await updateVideoUrl(item.table_name, item.row_id, result.url);
      if (updated) {
        await markQueueProcessed(item.id, 'completed');
        stats.updated++;
        console.log(`[Queue] ✓ Updated: ${item.video_title}`);
      } else {
        await markQueueProcessed(item.id, 'failed', 'Database update failed');
        stats.failed++;
      }
    } else {
      await markQueueProcessed(item.id, 'failed', result.message);
      stats.failed++;
      
      const failureInfo = { id: item.facebook_video_id, title: item.video_title || 'Unknown' };
      
      if (result.error === 'not_found') {
        stats.failures.notFound.push(failureInfo);
      } else if (result.error === 'permission_denied') {
        stats.failures.permissionDenied.push(failureInfo);
      } else {
        stats.failures.apiError.push(failureInfo);
      }
      
      console.log(`[Queue] ✗ Failed: ${item.video_title} - ${result.message}`);
    }
  }
}

async function processFreshVideos() {
  console.log('\n=== Checking All Videos (24-hour cycle) ===\n');
  
  const tables = [
    { name: 'episodes', videoUrlColumn: 'video_url', videoIdColumn: 'facebook_video_id' },
    { name: 'movies', videoUrlColumn: 'videoUrl', videoIdColumn: 'facebookVideoId' }
  ];

  for (const table of tables) {
    console.log(`\nChecking ${table.name} table...`);
    
    const { data: videos, error } = await supabase
      .from(table.name)
      .select(`id, title, ${table.videoUrlColumn}, ${table.videoIdColumn}`)
      .not(table.videoUrlColumn, 'is', null)
      .not(table.videoIdColumn, 'is', null)
      .neq(table.videoUrlColumn, 'NULL');

    if (error || !videos || videos.length === 0) {
      console.log(`No videos found in ${table.name}`);
      continue;
    }

    console.log(`Found ${videos.length} videos in ${table.name}`);

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      
      if (stats.apiCallsUsed >= MAX_API_CALLS) {
        console.log(`\nAPI limit reached. Queueing remaining ${videos.length - i} videos...`);
        
        for (let j = i; j < videos.length; j++) {
          const v = videos[j];
          const added = await addToQueue(
            table.name,
            v.id,
            v[table.videoIdColumn],
            v[table.videoUrlColumn],
            v.title
          );
          if (added) stats.queued++;
        }
        break;
      }

      stats.totalChecked++;
      
      const currentUrl = video[table.videoUrlColumn];
      const isValid = await isUrlValid(currentUrl);
      
      if (isValid) {
        stats.alreadyValid++;
        console.log(`[${i + 1}/${videos.length}] ✓ Valid: ${video.title}`);
        continue;
      }

      console.log(`[${i + 1}/${videos.length}] ⚠ Expired: ${video.title} - Updating...`);
      
      const result = await getFacebookVideoUrl(video[table.videoIdColumn]);
      
      if (result.success) {
        const updated = await updateVideoUrl(table.name, video.id, result.url);
        if (updated) {
          stats.updated++;
          console.log(`[${i + 1}/${videos.length}] ✓ Updated: ${video.title}`);
        } else {
          stats.failed++;
        }
      } else {
        stats.failed++;
        
        const failureInfo = { id: video[table.videoIdColumn], title: video.title };
        
        if (result.error === 'not_found') {
          stats.failures.notFound.push(failureInfo);
        } else if (result.error === 'permission_denied') {
          stats.failures.permissionDenied.push(failureInfo);
        } else {
          stats.failures.apiError.push(failureInfo);
        }
        
        console.log(`[${i + 1}/${videos.length}] ✗ Failed: ${video.title} - ${result.message}`);
      }
    }
  }
}

function generateReport() {
  const duration = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  
  let report = `🔄 <b>CDN URL Update Report (24h Cycle)</b>\n`;
  report += `━━━━━━━━━━━━━━━━━\n`;
  report += `⏰ ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC\n\n`;
  
  report += `📊 <b>Summary:</b>\n`;
  report += `✅ Total Checked: ${stats.totalChecked}\n`;
  report += `🟢 Already Valid: ${stats.alreadyValid}\n`;
  report += `🔄 Successfully Updated: ${stats.updated}\n`;
  report += `❌ Failed: ${stats.failed}\n`;
  
  if (stats.queued > 0) {
    report += `⏳ Queued for Next Run: ${stats.queued}\n`;
  }
  
  report += `\n📋 <b>Updates by Table:</b>\n`;
  report += `🎬 Episodes: ${stats.episodesUpdated}\n`;
  report += `🎥 Movies: ${stats.moviesUpdated}\n`;
  
  report += `\n📈 <b>API Usage:</b> ${stats.apiCallsUsed}/200\n`;
  report += `⏱️ <b>Duration:</b> ${minutes}m ${seconds}s\n`;
  
  if (stats.failures.notFound.length > 0) {
    report += `\n⚠️ <b>Videos Not Found (${stats.failures.notFound.length}):</b>\n`;
    stats.failures.notFound.slice(0, 5).forEach(item => {
      report += `  ❌ ${item.title}\n`;
    });
    if (stats.failures.notFound.length > 5) {
      report += `  ... and ${stats.failures.notFound.length - 5} more\n`;
    }
  }
  
  if (stats.failures.permissionDenied.length > 0) {
    report += `\n🔒 <b>Permission Denied (${stats.failures.permissionDenied.length}):</b>\n`;
    stats.failures.permissionDenied.slice(0, 3).forEach(item => {
      report += `  🔒 ${item.title}\n`;
    });
    if (stats.failures.permissionDenied.length > 3) {
      report += `  ... and ${stats.failures.permissionDenied.length - 3} more\n`;
    }
  }
  
  if (stats.queued === 0 && stats.failed === 0 && stats.updated > 0) {
    report += `\n\n✅ <b>All expired URLs updated successfully!</b>`;
  } else if (stats.queued === 0 && stats.totalChecked === stats.alreadyValid) {
    report += `\n\n✅ <b>All URLs are still valid. No updates needed.</b>`;
  } else if (stats.queued > 0) {
    report += `\n\n💡 <b>Note:</b> ${stats.queued} items queued for next 24-hour run.`;
  }
  
  report += `\n\n🔄 Next update: 24 hours from now`;
  
  return report;
}

async function processUrlUpdates() {
  stats = {
    totalChecked: 0,
    alreadyValid: 0,
    updated: 0,
    failed: 0,
    queued: 0,
    apiCallsUsed: 0,
    startTime: Date.now(),
    episodesUpdated: 0,
    moviesUpdated: 0,
    failures: { notFound: [], permissionDenied: [], apiError: [] }
  };

  console.log('\n========================================');
  console.log('=== 24-Hour URL Update Process Started ===');
  console.log(`=== Time: ${new Date().toISOString()} ===`);
  console.log('========================================\n');
  
  await sendTelegram('🚀 <b>24-Hour URL Update Started</b>\n\nChecking all video URLs for expiration...');

  try {
    await processQueue();

    if (stats.apiCallsUsed < MAX_API_CALLS) {
      console.log(`\nAPI calls remaining: ${MAX_API_CALLS - stats.apiCallsUsed}`);
      console.log('Scanning all videos in movies and episodes tables...\n');
      await processFreshVideos();
    } else {
      console.log('\nAPI limit reached during queue processing');
    }

    const report = generateReport();
    
    console.log('\n========================================');
    console.log('=== Process Complete ===');
    console.log('========================================');
    console.log(report.replace(/<[^>]*>/g, ''));
    console.log('========================================\n');
    
    await sendTelegram(report);

  } catch (error) {
    console.error('\n========================================');
    console.error('=== PROCESS ERROR ===');
    console.error('========================================');
    console.error('Error details:', error);
    console.error('========================================\n');
    
    await sendTelegram(`❌ <b>URL Update Error</b>\n\nError: ${error.message}\n\nTime: ${new Date().toISOString()}`);
  }
}

async function getQueueStatus() {
  try {
    const { count: pending } = await supabase
      .from('url_update_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: completed } = await supabase
      .from('url_update_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed');

    const { count: failed } = await supabase
      .from('url_update_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed');

    return {
      pending: pending || 0,
      completed: completed || 0,
      failed: failed || 0,
      lastCheck: new Date().toISOString(),
      message: 'Queue runs every 24 hours'
    };
  } catch (error) {
    console.error('Error getting queue status:', error);
    return { error: error.message };
  }
}

async function testFacebookVideo(videoId) {
  const result = await getFacebookVideoUrl(videoId);
  return result;
}

module.exports = { processUrlUpdates, getQueueStatus, testFacebookVideo };

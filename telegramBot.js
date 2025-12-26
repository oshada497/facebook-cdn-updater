const axios = require('axios');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT_IDS = process.env.TELEGRAM_ADMIN_IDS ? 
  process.env.TELEGRAM_ADMIN_IDS.split(',').map(id => id.trim()) : [];

let isProcessing = false;
let lastUpdateInfo = null;

async function sendMessage(chatId, text, parseMode = 'HTML') {
  try {
    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode
    });
  } catch (error) {
    console.error('Error sending Telegram message:', error.message);
  }
}

function isAuthorized(chatId) {
  if (ALLOWED_CHAT_IDS.length === 0) return true;
  return ALLOWED_CHAT_IDS.includes(chatId.toString());
}

async function handleTelegramUpdate(update) {
  if (!update.message || !update.message.text) return;

  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  const command = text.split(' ')[0].toLowerCase();

  console.log(`Telegram command: ${command} from chat ${chatId}`);

  if (!isAuthorized(chatId)) {
    await sendMessage(chatId, '❌ <b>Unauthorized</b>\n\nYou are not authorized to use this bot.');
    console.log(`Unauthorized access attempt from: ${chatId}`);
    return;
  }

  switch (command) {
    case '/start':
      await handleStart(chatId);
      break;
    case '/update':
      await handleUpdateCommand(chatId);
      break;
    case '/status':
      await handleStatus(chatId);
      break;
    case '/help':
      await handleHelp(chatId);
      break;
    case '/info':
      await handleInfo(chatId);
      break;
    default:
      await sendMessage(chatId, '❓ Unknown command. Type /help for available commands.');
  }
}

async function handleStart(chatId) {
  const message = `
👋 <b>Welcome to Facebook CDN URL Updater Bot!</b>

This bot helps you manage and update expired Facebook video URLs.

<b>Available Commands:</b>
/update - Check and update all expired URLs
/status - View queue status
/info - Last update information
/help - Show help

Your Chat ID: <code>${chatId}</code>

<i>Type /update to start checking your videos!</i>
  `.trim();

  await sendMessage(chatId, message);
}

async function handleUpdateCommand(chatId) {
  if (isProcessing) {
    await sendMessage(chatId, '⚠️ <b>Update Already Running</b>\n\nAn update is already in progress. Please wait for it to complete.');
    return;
  }

  isProcessing = true;

  await sendMessage(chatId, '🚀 <b>Update Started!</b>\n\n🔍 Checking all video URLs...\n⏳ This may take 1-5 minutes\n\n<i>You\'ll receive a detailed report when complete.</i>');

  try {
    const { processUrlUpdates } = require('./urlUpdater');
    await processUrlUpdates();
    
    lastUpdateInfo = {
      timestamp: new Date().toISOString(),
      success: true
    };

    await sendMessage(chatId, '✅ <b>Update Completed!</b>\n\nCheck the detailed report above for results.');

  } catch (error) {
    console.error('Error during update:', error);
    await sendMessage(chatId, `❌ <b>Update Error</b>\n\n<code>${error.message}</code>\n\nPlease check Render logs for details.`);
    
    lastUpdateInfo = {
      timestamp: new Date().toISOString(),
      success: false,
      error: error.message
    };
  } finally {
    isProcessing = false;
  }
}

async function handleStatus(chatId) {
  try {
    const { getQueueStatus } = require('./urlUpdater');
    const status = await getQueueStatus();

    const message = `
📊 <b>Queue Status</b>

⏳ <b>Pending:</b> ${status.pending}
✅ <b>Completed:</b> ${status.completed}  
❌ <b>Failed:</b> ${status.failed}

${isProcessing ? '🔄 <b>Status:</b> Update in progress...' : '💤 <b>Status:</b> Idle'}

⏰ <b>Last Check:</b> ${new Date(status.lastCheck).toLocaleString()}
    `.trim();

    await sendMessage(chatId, message);
  } catch (error) {
    await sendMessage(chatId, `❌ Error: ${error.message}`);
  }
}

async function handleInfo(chatId) {
  if (!lastUpdateInfo) {
    await sendMessage(chatId, '📝 <b>No Update Info</b>\n\nNo updates have been run since the bot started.\n\nUse /update to run your first update!');
    return;
  }

  const status = lastUpdateInfo.success ? '✅ Completed' : '❌ Failed';
  const message = `
📝 <b>Last Update Info</b>

⏰ <b>Time:</b> ${new Date(lastUpdateInfo.timestamp).toLocaleString()}
${status}

${lastUpdateInfo.error ? `\n<b>Error:</b> ${lastUpdateInfo.error}` : ''}

Type /update to run a new update.
  `.trim();

  await sendMessage(chatId, message);
}

async function handleHelp(chatId) {
  const message = `
📚 <b>Bot Commands</b>

<b>/update</b> - Check and update expired URLs
  • Scans episodes and movies tables
  • Tests each URL validity
  • Updates expired URLs from Facebook
  • Sends detailed report

<b>/status</b> - View queue status
  • Pending/completed/failed counts
  • Current process status

<b>/info</b> - Last update info
  • When last update ran
  • Success/failure status

<b>/help</b> - Show this help

<b>How It Works:</b>
1. Bot checks all video URLs in database
2. Tests if each URL is still accessible
3. Updates expired URLs with fresh ones
4. Sends you a complete report

<i>Updates take 1-5 minutes depending on video count.</i>
  `.trim();

  await sendMessage(chatId, message);
}

async function setWebhook(webhookUrl) {
  try {
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      url: webhookUrl,
      allowed_updates: ['message']
    });
    console.log('Telegram webhook set:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error setting webhook:', error.message);
    throw error;
  }
}

async function deleteWebhook() {
  try {
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    console.log('Webhook deleted:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error deleting webhook:', error.message);
    throw error;
  }
}

module.exports = {
  handleTelegramUpdate,
  setWebhook,
  deleteWebhook,
  sendMessage
};

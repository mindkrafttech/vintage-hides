// api/cron.js — PRODUCTION COMPLETE
// Vercel Cron (runs 2AM daily) + handles external cron calls every 15min
// External cron: https://cron-job.org → call /api/cron?secret=YOUR_CRON_SECRET every 15min
require('dotenv').config();
const { processPendingQueue, triggerWinbackCampaign, processAffiliateCommissions } = require('../lib/automation');

module.exports = async (req, res) => {
  // Protect from unauthorized calls
  const secret = req.headers['x-cron-secret'] || req.query?.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';

  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const task = req.query?.task || 'queue';

  try {
    if (task === 'winback') {
      const result = await triggerWinbackCampaign();
      return res.json({ success: true, task: 'winback', ...result });
    }

    // Default: process queue
    const result = await processPendingQueue(100);
    const commResult = await processAffiliateCommissions();

    // Also run winback on Vercel daily cron (2AM)
    if (isVercelCron) {
      const winback = await triggerWinbackCampaign().catch(() => ({ queued: 0 }));
      return res.json({
        success: true, task: 'daily',
        queue: result,
        winback,
        timestamp: new Date().toISOString()
      });
    }

    return res.json({ success: true, task: 'queue', ...result, timestamp: new Date().toISOString() });
  } catch (e) {
    console.error('Cron error:', e);
    return res.status(500).json({ error: e.message });
  }
};

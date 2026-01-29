import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import { processWebhook } from './bot/processor.js';

const app = express();
app.use(express.json());

// Validate Neynar webhook signature
function validateWebhook(signature: string | undefined, body: unknown): boolean {
  if (!signature || !process.env.WEBHOOK_SECRET) {
    return false;
  }

  const hash = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');

  return signature === hash;
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'roadmapr-bot',
    timestamp: new Date().toISOString()
  });
});

// Neynar webhook endpoint for bot mentions
app.post('/webhook/mention', async (req, res) => {
  try {
    const signature = req.headers['x-neynar-signature'] as string;

    // Validate signature in production
    if (process.env.NODE_ENV === 'production' && !validateWebhook(signature, req.body)) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Log incoming webhook
    console.log('Received webhook:', JSON.stringify(req.body, null, 2));

    // Process asynchronously (respond immediately)
    processWebhook(req.body).catch(err => {
      console.error('Webhook processing error:', err);
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Manual trigger endpoint (for testing)
app.post('/trigger', async (req, res) => {
  try {
    const { cast_hash, parent_hash, author_fid } = req.body;

    if (!cast_hash) {
      return res.status(400).json({ error: 'cast_hash required' });
    }

    const result = await processWebhook({
      data: {
        hash: cast_hash,
        author: { fid: author_fid || 1 },
        parent_hash: parent_hash
      }
    });

    res.json({ success: true, result });
  } catch (err) {
    console.error('Trigger error:', err);
    res.status(500).json({ error: 'Processing failed' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Roadmapr Bot listening on port ${PORT}`);
  console.log('Endpoints:');
  console.log(`  GET  /health - Health check`);
  console.log(`  POST /webhook/mention - Neynar webhook`);
  console.log(`  POST /trigger - Manual trigger (testing)`);
});

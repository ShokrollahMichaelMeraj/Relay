const express = require('express');
const { createClient } = require('redis');
const config = require('./config');
const twilioRoutes = require('./routes/twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use('/webhooks/twilio', twilioRoutes); // ADD THIS

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Redis client
const redis = createClient({ url: config.redis.url });
redis.on('error', (err) => console.error('Redis error:', err));

async function start() {
  await redis.connect();
  console.log('Redis connected');

  app.listen(config.port, () => {
    console.log(`Relay running on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});

module.exports = { app, redis };
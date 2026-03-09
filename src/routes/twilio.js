const express = require('express');
const twilio = require('twilio');

const router = express.Router();

// 1. Customer calls in
router.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say('Please hold while we connect you to an agent.');
  twiml.pause({ length: 60 });
  res.type('text/xml').send(twiml.toString());
});

// 2. Call complete
router.post('/complete', (req, res) => {
  console.log('Call completed:', req.body.CallSid);
  res.sendStatus(200);
});

module.exports = router;
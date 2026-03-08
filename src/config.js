require('dotenv').config();

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

module.exports = {
  port: process.env.PORT || 3000,

  twilio: {
    accountSid:  required('TWILIO_ACCOUNT_SID'),
    authToken:   required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },

  openai: {
    apiKey:            required('OPENAI_API_KEY'),
    realtimeModel:     process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview',
    voice:             process.env.OPENAI_VOICE || 'nova',
    silenceDurationMs: parseInt(process.env.RELAY_SILENCE_DURATION_MS || '800'),
    maxTurns:          parseInt(process.env.RELAY_MAX_TURNS || '15'),
    maxResponseTokens: parseInt(process.env.RELAY_MAX_RESPONSE_TOKENS || '150'),
  },

  redis: {
    url:      required('REDIS_URL'),
    ttlHours: parseInt(process.env.REDIS_SESSION_TTL_HOURS || '2'),
  },

  email: {
    apiKey: required('RESEND_API_KEY'),
    to:     required('AGENT_EMAIL'),
    from:   process.env.FROM_EMAIL || 'relay@yourdomain.com',
  },
};
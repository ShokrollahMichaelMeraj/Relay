#!/bin/bash

#create the following tree:

# relay/
# ├── .env
# ├── .env.example
# ├── .gitignore
# ├── package.json
# │
# └── src/
#     ├── index.js                 ← starts server, connects Redis
#     ├── config.js                ← loads + validates env vars
#     │
#     ├── routes/
#     │   └── twilio.js            ← 4 webhooks: voice, hold, transfer, complete
#     │
#     ├── services/
#     │   ├── session.js           ← Redis create/read/update
#     │   ├── voice.js             ← OpenAI Realtime WebSocket
#     │   ├── brief.js             ← GPT-4o brief generation
#     │   └── email.js             ← Resend email delivery
#     │
#     ├── prompt.js                ← builds OpenAI system prompt
#     └── template.js              ← hardcoded intake fields

set -e

mkdir -p src/routes
mkdir -p src/services
touch .env

touch .env.example
touch .gitignore

touch package.json

touch src/index.js
touch src/config.js
touch src/routes/twilio.js
touch src/services/session.js
touch src/services/voice.js
touch src/services/brief.js
touch src/services/email.js
touch src/prompt.js
touch src/template.js

echo "✅ Relay project scaffolded"

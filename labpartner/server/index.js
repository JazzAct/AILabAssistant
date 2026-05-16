import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { existsSync, readFileSync } from 'fs';

loadLocalEnv();

const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL
  || process.env.OPENCLAW_NEMOTRON_MODEL
  || process.env.NEMOTRON_MODEL
  || 'nvidia/llama-3.1-nemotron-340b-instruct';
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const MODEL_INFO = {
  provider: 'nvidia',
  model: NVIDIA_MODEL,
  baseURL: NVIDIA_BASE_URL,
  configured: Boolean(NVIDIA_API_KEY),
};

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'AI Lab Partner server running' });
});

app.get('/model', (req, res) => {
  res.json(MODEL_INFO);
});

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  const history = [];
  ws.send(JSON.stringify({
    type: 'CONNECTED',
    message: `Server ready. Chat model: ${NVIDIA_MODEL}`,
    model: MODEL_INFO,
  }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log('[WS] Received:', msg.type);

      if (msg.type === 'START_AGENT' || msg.type === 'USER_PROMPT') {
        const text = msg.payload?.goal || msg.payload?.text || '';
        if (!text.trim()) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Prompt was empty.' }));
          return;
        }

        history.push({ role: 'user', content: text });
        ws.send(JSON.stringify({ type: 'THINKING', message: `Sending prompt to ${NVIDIA_MODEL}...` }));

        const reply = await completeWithNvidia(history);
        history.push({ role: 'assistant', content: reply });
        ws.send(JSON.stringify({ type: 'ASSISTANT_MESSAGE', message: reply, model: MODEL_INFO }));
        return;
      }

      ws.send(JSON.stringify({ type: 'ACK', received: msg.type }));
    } catch (error) {
      console.error('[WS] Error:', error);
      ws.send(JSON.stringify({ type: 'ERROR', message: error.message }));
    }
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] WebSocket ready on ws://localhost:${PORT}`);
  console.log(`[server] Chat model: ${NVIDIA_MODEL}`);
  console.log(`[server] NVIDIA API key configured: ${NVIDIA_API_KEY ? 'yes' : 'no'}`);
});

function loadLocalEnv() {
  if (!existsSync('.env')) return;

  const lines = readFileSync('.env', 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function completeWithNvidia(messages) {
  if (!NVIDIA_API_KEY) {
    throw new Error('NVIDIA_API_KEY is not configured. Add it to labpartner/server/.env and restart the server.');
  }

  const body = {
    model: NVIDIA_MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are AI Lab Partner, a concise engineering assistant for embedded systems and lab debugging. Answer directly and do not show hidden reasoning.',
      },
      ...messages,
    ],
    temperature: 0.1,
    top_p: 1,
    max_tokens: 2048,
    stream: false,
  };

  if (NVIDIA_MODEL === 'nvidia/usdcode-llama-3.1-70b-instruct') {
    body.expert_type = 'auto';
  }

  const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`NVIDIA chat request failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  return message?.content || message?.reasoning_content || message?.reasoning || '(empty response)';
}

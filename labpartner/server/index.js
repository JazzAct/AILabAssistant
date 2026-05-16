import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'AI Lab Partner server running' });
});

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Server ready' }));

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    console.log('[WS] Received:', msg);
    ws.send(JSON.stringify({ type: 'ACK', received: msg.type }));
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
  console.log(`[server] WebSocket ready on ws://localhost:${PORT}`);
});
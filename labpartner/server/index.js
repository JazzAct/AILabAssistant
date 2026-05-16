import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import multer from 'multer';
import { agentLoop } from './agent/loop.js';
import { SerialMonitor } from './serial/monitor.js';
import { debugRoute } from './routes/debug.js';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// Active serial monitor instance (one per session for now)
let serialMonitor = null;

// WebSocket: each connection gets a unique session
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw);

    if (msg.type === 'START_AGENT') {
      // msg.payload: { goal, projectPath, port, datasheetText, maxIterations }
      try {
        await agentLoop({
          ...msg.payload,
          emit: (event) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify(event));
            }
          },
        });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
      }
    }

    if (msg.type === 'START_SERIAL') {
      // msg.payload: { port, baudRate }
      if (serialMonitor) serialMonitor.close();
      serialMonitor = new SerialMonitor(msg.payload.port, msg.payload.baudRate || 115200);
      serialMonitor.on('data', (line) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'SERIAL_LINE', data: line }));
        }
      });
      serialMonitor.open();
    }

    if (msg.type === 'STOP_SERIAL') {
      if (serialMonitor) {
        serialMonitor.close();
        serialMonitor = null;
      }
    }

    if (msg.type === 'APPLY_FIX') {
      // Student clicked "Yes, apply fix" — agent writes the file
      // msg.payload: { filePath, newContent }
      const { applyFix } = await import('./tools/fileTools.js');
      await applyFix(msg.payload.filePath, msg.payload.newContent);
      ws.send(JSON.stringify({ type: 'FIX_APPLIED', filePath: msg.payload.filePath }));
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
    if (serialMonitor) {
      serialMonitor.close();
      serialMonitor = null;
    }
  });
});

// REST: one-shot debug (from doc v1 — image + log upload)
app.post('/api/debug', upload.single('image'), debugRoute);

// REST: list available serial ports
app.get('/api/ports', async (req, res) => {
  const { SerialPort } = await import('serialport');
  const ports = await SerialPort.list();
  res.json(ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer })));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
});

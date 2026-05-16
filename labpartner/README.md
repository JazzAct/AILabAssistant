# AI Lab Partner — Backend

Autonomous ESP32 debugging agent. The agent writes firmware, builds it, flashes it, reads the serial monitor, and iterates — all without being prompted between steps.

## Architecture

```
Frontend (React + Vite)
  └── useAgentSocket.js        WebSocket hook — sends goals, receives events
  └── AgentTransparencyPanel   Live event stream UI

Backend (Node.js + Express)
  └── index.js                 HTTP + WebSocket server
  └── agent/loop.js            ← THE CORE: autonomous agent loop
  └── tools/espTools.js        build / flash / serial read
  └── tools/fileTools.js       read / write files (path-sandboxed)
  └── tools/datasheetTools.js  keyword search over PDF text
  └── serial/monitor.js        persistent serial stream (for live dashboard)
  └── routes/debug.js          one-shot diagnostic (image + log upload)
```

## The autonomous loop

```
Student types a goal
        ↓
agent/loop.js starts
        ↓
Nemotron writes main.c  ← tool: write_file
        ↓
idf.py build            ← tool: build_project
   ↓ (if errors)
Nemotron reads errors, patches file, rebuilds
        ↓
idf.py flash            ← tool: flash_device (requires student approval)
        ↓
Read serial monitor     ← tool: read_serial
        ↓
Nemotron judges: goal met?
   ↓ no → back to write step (up to maxIterations)
   ↓ yes → GOAL_ACHIEVED
```

Every step emits a typed event over WebSocket so the UI can show exactly what the agent is doing in real time.

## Setup

### Prerequisites
- Node.js 20+
- ESP-IDF installed and `idf.py` on PATH
- `ANTHROPIC_API_KEY` set in environment

### Install
```bash
cd server
npm install
```

### Environment variables
```
ANTHROPIC_API_KEY=sk-...
PROJECT_ROOT=/home/student/esp    # agent can only write files here
PORT=3001
```

### Run
```bash
cd server
npm run dev
```

## WebSocket API

**Client → Server:**
```json
{ "type": "START_AGENT", "payload": {
    "goal": "Make the motor move 90 degrees then -90 degrees",
    "projectPath": "/home/student/esp/lab6/lab6_2",
    "port": "/dev/ttyUSB0",
    "datasheetText": "...",   // optional, from PDF upload
    "maxIterations": 5
}}

{ "type": "START_SERIAL", "payload": { "port": "/dev/ttyUSB0", "baudRate": 115200 }}
{ "type": "STOP_SERIAL" }
{ "type": "APPROVE_FLASH" }
```

**Server → Client (event stream):**
```
THINKING          — agent reasoning text
FILE_READ         — agent opened a file
FILE_WRITE        — agent wrote a file
BUILD_START       — idf.py build began
BUILD_OUTPUT      — one line of compiler output
BUILD_RESULT      — build succeeded or failed
FLASH_START       — flashing began
FLASH_DONE        — flash complete
SERIAL_READING    — reading serial for N seconds
JUDGMENT          — agent's pass/fail decision + reasoning
ITERATION         — iteration N of M
GOAL_ACHIEVED     — loop complete, goal met
GIVING_UP         — max iterations reached
AWAITING_APPROVAL — agent wants to flash, waiting for student click
SERIAL_LINE       — live serial line (from persistent monitor)
ERROR             — something went wrong
```

## NemoClaw integration

To deploy via NemoClaw, wrap the agent loop with NemoClaw's sandbox:
- Allowlist tools: `build_project`, `flash_device`, `read_serial`, `read_file`, `write_file`
- Restrict `write_file` to `PROJECT_ROOT` only (already enforced in fileTools.js)
- Restrict shell commands to `idf.py build`, `idf.py flash`, `idf.py monitor`
- Nemotron runs locally on-device — no data leaves the machine

This satisfies the NemoClaw bonus track: policy-gated tool execution with demonstrable security controls.

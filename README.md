# 🤖 AutoEmbed

AutoEmbed is an autonomous embedded systems debugging agent for ESP32 projects.  
It can write firmware, build code, analyze errors, flash the board with approval, read serial monitor output, and iterate until the goal is achieved.

---

## 🚀 Inspiration

Debugging embedded systems can be slow, repetitive, and frustrating. Students often get stuck reading compiler errors, fixing firmware bugs, checking wiring, and running the same build/flash/monitor cycle repeatedly.

AutoEmbed acts like an autonomous AI lab partner that helps developers debug real hardware projects faster.

---

## ✨ What It Does

- Accepts user goals such as:
  `"Make the motor move 90 degrees then -90 degrees"`
- Writes or edits ESP32 firmware
- Runs `idf.py build`
- Reads build errors and patches code
- Requests approval before flashing hardware
- Runs `idf.py flash`
- Reads serial monitor output
- Judges whether the goal was achieved
- Repeats the process autonomously

---

## 🧠 Key Features

- Autonomous ESP32 debugging loop
- Real-time WebSocket event stream
- Live transparency dashboard
- Serial monitor reasoning
- Compiler-aware code patching
- Path-sandboxed file editing
- Human approval before flashing
- Built for edge AI workflows

---

## 🏗️ Architecture

```txt
Frontend (React + Vite)
  └── WebSocket UI
  └── Live transparency dashboard

Backend / Agent
  └── Autonomous agent loop
  └── ESP-IDF build / flash tools
  └── Serial monitor reader
  └── File read/write tools
  └── Datasheet search tools

Embedded Layer
  └── ESP32
  └── ESP-IDF
  └── Serial monitor
```

---

## 🔁 Autonomous Agent Loop

```txt
Student enters goal
        ↓
Agent writes firmware
        ↓
Runs idf.py build
        ↓
Reads compiler errors
        ↓
Patches code automatically
        ↓
Requests flash approval
        ↓
Runs idf.py flash
        ↓
Reads serial monitor
        ↓
Judges success/failure
        ↓
Repeats until goal achieved
```

---

## 🖥️ Live Transparency Dashboard

The dashboard displays every action the AI takes in real time:

- Agent reasoning
- File reads/writes
- Build output
- Flashing progress
- Serial monitor logs
- Debugging judgments
- Final success/failure state

This allows users to observe and trust the autonomous workflow.

---

## 🛠️ Built With

- React
- Vite
- JavaScript
- HTML / CSS
- Node.js
- Express
- WebSockets
- ESP-IDF
- ESP32
- NVIDIA Nemotron
- GitHub

---

## 📁 Project Structure

```txt
AutoEmbed/
├── frontend/       # React + Vite frontend
├── labpartner/     # Backend autonomous agent
└── .gitignore
```

---

## ⚙️ Setup

### Clone the repository

```bash
git clone https://github.com/JazzAct/AILabAssistant.git
cd AILabAssistant
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd ../labpartner
npm install
npm run dev
```

---

## 🔐 Environment Variables

Create a `.env` file inside the backend folder:

```env
ANTHROPIC_API_KEY=your_api_key_here
PROJECT_ROOT=/home/student/esp
PORT=3001
```

---

## 🧪 Example Goal

```txt
Make the ESP32 blink an LED every second and print "LED toggled" to the serial monitor.
```

AutoEmbed will:

1. Edit firmware
2. Build the project
3. Fix build errors
4. Request flash approval
5. Flash the board
6. Read serial output
7. Verify the result autonomously

---

## 🌍 Real-World Applications

- Robotics
- Smart manufacturing
- Autonomous drones
- Industrial IoT
- Embedded systems education
- Remote/offline edge systems

---

## 🔒 Safety Features

- Restricted project sandbox
- Allowlisted ESP-IDF commands
- Flash approval system
- Transparent real-time monitoring

---

## 🏆 Hackathon Focus

AutoEmbed demonstrates autonomous AI agents interacting directly with embedded hardware, enabling intelligent debugging and real-time firmware iteration on edge devices.

---

## 📌 Future Improvements

- Breadboard image understanding
- Sensor auto-detection
- Multi-board support
- Voice-controlled debugging
- Local on-device inference
- Full NemoClaw integration

---

## 📄 License

Built for educational and hackathon purposes.

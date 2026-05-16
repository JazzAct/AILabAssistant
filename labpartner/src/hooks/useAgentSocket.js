import { useEffect, useRef, useCallback, useState } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

/**
 * useAgentSocket — connects to the backend WebSocket and drives the agent loop.
 *
 * Returns:
 *   events[]         — all events received (for the live transparency panel)
 *   serialLines[]    — live serial output lines
 *   status           — 'idle' | 'running' | 'waiting_approval' | 'done' | 'error'
 *   startAgent(opts) — kick off the autonomous loop
 *   startSerial(port, baud) — open serial monitor stream
 *   stopSerial()
 *   approveFlash()   — student clicks "Yes, flash it"
 */
export function useAgentSocket() {
  const ws = useRef(null);
  const [events, setEvents] = useState([]);
  const [serialLines, setSerialLines] = useState([]);
  const [status, setStatus] = useState('idle');
  const [pendingApproval, setPendingApproval] = useState(null);

  const addEvent = useCallback((event) => {
    setEvents(prev => [...prev, { ...event, ts: Date.now() }]);
  }, []);

  useEffect(() => {
    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);

      // Route serial lines separately (high frequency)
      if (msg.type === 'SERIAL_LINE') {
        setSerialLines(prev => [...prev.slice(-500), msg.data]);
        return;
      }

      // Track approval gate
      if (msg.type === 'AWAITING_APPROVAL') {
        setStatus('waiting_approval');
        setPendingApproval(msg);
      }

      if (msg.type === 'FLASH_START') {
        setStatus('running');
        setPendingApproval(null);
      }

      if (msg.type === 'GOAL_ACHIEVED' || msg.type === 'GIVING_UP') {
        setStatus('done');
      }

      if (msg.type === 'ERROR') {
        setStatus('error');
      }

      addEvent(msg);
    };

    socket.onerror = () => setStatus('error');
    socket.onclose = () => {
      if (status === 'running') setStatus('error');
    };

    return () => socket.close();
  }, []);

  const send = useCallback((msg) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  const startAgent = useCallback(({ goal, projectPath, port, datasheetText, maxIterations }) => {
    setEvents([]);
    setSerialLines([]);
    setStatus('running');
    send({
      type: 'START_AGENT',
      payload: { goal, projectPath, port, datasheetText, maxIterations },
    });
  }, [send]);

  const startSerial = useCallback((port, baudRate = 115200) => {
    setSerialLines([]);
    send({ type: 'START_SERIAL', payload: { port, baudRate } });
  }, [send]);

  const stopSerial = useCallback(() => {
    send({ type: 'STOP_SERIAL' });
  }, [send]);

  const approveFlash = useCallback(() => {
    // Student clicked "Yes, flash it" — backend is polling for this
    // In the full impl, send an ACK; for the hackathon the loop auto-resumes
    setStatus('running');
    setPendingApproval(null);
    send({ type: 'APPROVE_FLASH' });
  }, [send]);

  return {
    events,
    serialLines,
    status,
    pendingApproval,
    startAgent,
    startSerial,
    stopSerial,
    approveFlash,
  };
}

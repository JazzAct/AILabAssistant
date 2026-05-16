import React, { useEffect, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'

export default function App() {
  const ws = useRef(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pendingApproval, setPendingApproval] = useState(null)
  const [agentStarted, setAgentStarted] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const [attachments, setAttachments] = useState([]) // {file, preview, type, previewText}
  const messagesRef = useRef(null)
  const [openFile, setOpenFile] = useState(null)

  function pushEvent(type, payload) {
    const text = typeof payload === 'string' ? payload : (payload && payload.message) ? payload.message : JSON.stringify(payload)
    setMessages(prev => [...prev, { sender: 'assistant', type, text, ts: Date.now() }])
  }

  function send(msg) {
    try {
      if (!ws.current) return
      if (ws.current.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
      else {
        ws.current.__sendQueue = ws.current.__sendQueue || []
        ws.current.__sendQueue.push(msg)
      }
    } catch (err) { console.error('send error', err) }
  }

  useEffect(() => {
    if (!messagesRef.current) return
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages, input, attachments])
  useEffect(() => {
    const socket = new WebSocket(WS_URL)
    ws.current = socket

    socket.onopen = () => {
      setConnected(true)
      pushEvent('SYSTEM', 'Connected to server')
      // flush queued messages
      if (ws.current?.__sendQueue?.length) {
        ws.current.__sendQueue.forEach(m => ws.current.send(JSON.stringify(m)))
        ws.current.__sendQueue = []
      }
    }

    socket.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch (err) { msg = { type: 'RAW', message: e.data } }

      // high-frequency serial lines handled separately
      if (msg.type === 'SERIAL_LINE') {
        pushEvent('SERIAL_LINE', msg.data)
        return
      }

      if (msg.type === 'AWAITING_APPROVAL') {
        setPendingApproval(msg)
      }

      // For simple servers that send back an object with `message`
      pushEvent(msg.type || 'MSG', msg.message || JSON.stringify(msg))
    }

    socket.onclose = () => {
      setConnected(false)
      pushEvent('SYSTEM', 'Socket closed — attempting reconnect...')
      // try to reconnect after a short delay
      setTimeout(() => {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED) {
          const next = new WebSocket(WS_URL)
          ws.current = next
        }
      }, 2000)
    }

    socket.onerror = () => pushEvent('ERROR', 'WebSocket error')

    return () => socket.close()
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    const hasText = input.trim().length > 0
    if (!hasText && attachments.length === 0) return
    const text = input.trim()
    if (hasText) {
      setMessages(prev => [...prev, { sender: 'user', text, ts: Date.now() }])
      setInput('')
    } else {
      // file-only send: show filenames as the user's message
      const names = attachments.map(a => a.file.name).join(', ')
      setMessages(prev => [...prev, { sender: 'user', text: `Sent files: ${names}`, ts: Date.now() }])
    }

    // If attachments exist, upload them together with the prompt to /api/debug
    const doUpload = async () => {
      if (attachments.length === 0) return null
      const fd = new FormData()
      let combinedCode = ''
      for (const a of attachments) {
        if (a.type === 'image') fd.append('image', a.file)
        else combinedCode += `\n// ---- ${a.file.name} ----\n${a.file ? await a.file.text() : ''}\n`
      }
      if (combinedCode) fd.append('code', combinedCode)
      // pass the prompt as `components` so backend gets context
      fd.append('components', text)
      try {
        setUploading(true)
        const resp = await fetch('/api/debug', { method: 'POST', body: fd })
        const json = await resp.json()
        setMessages(prev => [...prev, { sender: 'assistant', text: JSON.stringify(json, null, 2), ts: Date.now() }])
      } catch (err) {
        setMessages(prev => [...prev, { sender: 'assistant', text: `Upload failed: ${err.message}`, ts: Date.now() }])
      } finally {
        setUploading(false)
        setAttachments([])
      }
    }

    // Send START_AGENT / USER_PROMPT over websocket when there's text.
    // If this is a file-only send, notify the agent with a USER_ATTACHMENT event.
    if (hasText) {
      if (!agentStarted) {
        send({ type: 'START_AGENT', payload: { goal: text } })
        setAgentStarted(true)
      } else {
        send({ type: 'USER_PROMPT', payload: { text } })
      }
    } else {
      // Informational: list filenames sent. Backend may ignore if not needed.
      try { send({ type: 'USER_ATTACHMENT', payload: { files: attachments.map(a => a.file.name) } }) } catch (err) { /* ignore */ }
    }

    // Fire-and-forget upload (wait for it)
    doUpload()
  }

  function approveFlash() {
    send({ type: 'APPROVE_FLASH' })
    setPendingApproval(null)
  }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const next = []
    for (const file of files) {
      if (file.type && file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataURL(file)
        next.push({ file, preview: dataUrl, type: 'image' })
      } else {
        let text = ''
        try { text = await file.text() } catch (err) { text = '' }
        const preview = text ? text.slice(0, 800) : '(binary file)'
        next.push({ file, preview: null, type: 'code', previewText: preview })
      }
    }

    // append to attachments state (do not send yet)
    setAttachments(prev => [...prev, ...next])
    // clear input
    e.target.value = ''
  }

  function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(fr.result)
      fr.onerror = rej
      fr.readAsDataURL(file)
    })
  }

  return (
    <div className="app">
      <div className="app-header">
        <div className="logo">AI</div>
        <div>
          <h1>AI Lab Partner</h1>
          <div className="subtitle">Interactive agent — ask a goal and follow the loop</div>
        </div>
      </div>

      <div style={{marginTop:12}}>
        <div className="status">Status: {connected ? 'connected' : 'disconnected'}</div>

        <div className="layout">
          <div className="chat-main">
            <div className="chat">
              <div className="messages" ref={messagesRef}>
                {messages.map((m,i) => (
                  <div key={i} className={`message ${m.sender}`}>
                    <div className="bubble">
                      {m.file ? (
                        <div>
                          <strong>{m.sender === 'user' ? 'You' : (m.type || 'Assistant')}</strong>
                          <div style={{marginTop:8}}>
                            <img src={m.file} alt={m.text} style={{maxWidth:240,borderRadius:8,display:'block'}} />
                            <div style={{marginTop:6,fontSize:12,color:'#6b7280'}}>{m.text}</div>
                          </div>
                        </div>
                      ) : (
                        m.text && (m.text.trim().startsWith('{') || m.text.trim().startsWith('[')) ? (
                          <div><strong>{m.sender === 'user' ? 'You' : (m.type || 'Assistant')}</strong><pre style={{whiteSpace:'pre-wrap',marginTop:6}}>{m.text}</pre></div>
                        ) : (
                          <div><strong>{m.sender === 'user' ? 'You' : (m.type || 'Assistant')}</strong><div style={{marginTop:6}}>{m.text}</div></div>
                        )
                      )}
                      <div className="meta">{new Date(m.ts).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>

              {pendingApproval && (
                <div style={{marginTop:8}} className="uploader">
                  <div style={{marginBottom:6}}>Agent requests approval: <strong>{pendingApproval.action || pendingApproval.type}</strong></div>
                  <button className="btn primary" onClick={approveFlash}>Approve</button>
                </div>
              )}

              {/* attachments row above prompt */}
              {attachments.length > 0 && (
                <div className="attachments-row">
                  {attachments.map((a, idx) => (
                    <div key={idx} className="attachment-chip">
                      <button className="remove" onClick={() => setAttachments(prev => prev.filter((_,i)=>i!==idx))}>−</button>
                      <div style={{maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.file.name}</div>
                      <div style={{flex:1}} />
                      <button className="open" onClick={() => setOpenFile({ ...a, idx })}>Open</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="controls">
                <div className="input-area">
                  <button type="button" className="plus-btn" onClick={() => fileRef.current?.click()}>+</button>
                  <form onSubmit={handleSubmit} style={{display:'flex',flex:1}}>
                    <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type a goal or prompt..." />
                  </form>
                  <button className="send-btn" onClick={handleSubmit}>Send</button>
                </div>
                <input ref={fileRef} type="file" accept=".c,.h,.cpp,.cc,.py,.m,.js,.ts,.json,.txt,.ino,.java,.rs,.go,.sh,image/*" multiple style={{display:'none'}} onChange={(e) => handleFileChange(e)} />
              </div>
            </div>
          </div>

          {openFile && (
            <div style={{width:380}}>
              <div className="file-panel">
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <strong>{openFile.file.name}</strong>
                  <button className="btn ghost" onClick={() => setOpenFile(null)}>Close</button>
                </div>
                {openFile.type === 'image' ? (
                  <img src={openFile.preview} alt={openFile.file.name} style={{maxWidth:'100%',borderRadius:6}} />
                ) : (
                  <pre>{openFile.previewText || '(no preview available)'}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Upload UI removed per request

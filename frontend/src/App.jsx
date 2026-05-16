import React, { useEffect, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'

function ThinkingIndicator() {
  return (
    <div className="thinking">
      <span className="dot" /><span className="dot" /><span className="dot" />
    </div>
  )
}

export default function App() {
  const ws = useRef(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pendingApproval, setPendingApproval] = useState(null)
  const [agentStarted, setAgentStarted] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [chatModel, setChatModel] = useState(null)
  const fileRef = useRef(null)
  const [attachments, setAttachments] = useState([])
  const messagesRef = useRef(null)
  const [openFile, setOpenFile] = useState(null)
  const textareaRef = useRef(null)

  function pushEvent(type, payload) {
    const text = typeof payload === 'string' ? payload : (payload?.message ?? JSON.stringify(payload))
    setMessages(prev => [...prev, { sender: 'assistant', type, text, ts: Date.now() }])
    setThinking(false)
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
  }, [messages, thinking, attachments])

  useEffect(() => {
    const socket = new WebSocket(WS_URL)
    ws.current = socket
    socket.onopen = () => {
      setConnected(true)
      pushEvent('SYSTEM', 'Connected — send a goal to begin.')
      if (ws.current?.__sendQueue?.length) {
        ws.current.__sendQueue.forEach(m => ws.current.send(JSON.stringify(m)))
        ws.current.__sendQueue = []
      }
    }
    socket.onmessage = (e) => {
      let msg
      try { msg = JSON.parse(e.data) } catch { msg = { type: 'RAW', message: e.data } }
      if (msg.type === 'SERIAL_LINE') { pushEvent('SERIAL_LINE', msg.data); return }
      if (msg.type === 'AWAITING_APPROVAL') setPendingApproval(msg)
      if (msg.model) setChatModel(msg.model)
      if (msg.type === 'CONNECTED') return
      if (msg.type === 'THINKING') return
      pushEvent(msg.type || 'MSG', msg.message || JSON.stringify(msg))
    }
    socket.onclose = () => {
      setConnected(false)
      pushEvent('SYSTEM', 'Disconnected — reconnecting…')
      setTimeout(() => {
        if (!ws.current || ws.current.readyState === WebSocket.CLOSED)
          ws.current = new WebSocket(WS_URL)
      }, 2000)
    }
    socket.onerror = () => pushEvent('ERROR', 'WebSocket error')
    return () => socket.close()
  }, [])

  async function handleSubmit(e) {
    e?.preventDefault()
    const hasText = input.trim().length > 0
    if (!hasText && attachments.length === 0) return
    const text = input.trim()

    if (hasText) {
      setMessages(prev => [...prev, { sender: 'user', text, ts: Date.now() }])
      setInput('')
      setThinking(true)
      if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    } else {
      setMessages(prev => [...prev, { sender: 'user', text: attachments.map(a => a.file.name).join(', '), ts: Date.now() }])
    }

    if (attachments.length > 0) {
      const fd = new FormData()
      let code = ''
      for (const a of attachments) {
        if (a.type === 'image') fd.append('image', a.file)
        else code += `\n// ---- ${a.file.name} ----\n${a.file ? await a.file.text() : ''}\n`
      }
      if (code) fd.append('code', code)
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

    if (hasText) {
      if (!agentStarted) { send({ type: 'START_AGENT', payload: { goal: text } }); setAgentStarted(true) }
      else send({ type: 'USER_PROMPT', payload: { text } })
    } else {
      try { send({ type: 'USER_ATTACHMENT', payload: { files: attachments.map(a => a.file.name) } }) } catch { }
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  function approveFlash() { send({ type: 'APPROVE_FLASH' }); setPendingApproval(null) }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const next = []
    for (const file of files) {
      if (file.type?.startsWith('image/')) {
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file)
        })
        next.push({ file, preview: dataUrl, type: 'image' })
      } else {
        let text = ''; try { text = await file.text() } catch { }
        next.push({ file, preview: null, type: 'code', previewText: text.slice(0, 800) || '(binary)' })
      }
    }
    setAttachments(prev => [...prev, ...next])
    e.target.value = ''
  }

  function labelType(type) {
    if (!type || type === 'MSG' || type === 'ASSISTANT_MESSAGE') return null
    return type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
  }

  function renderMessageText(text, { isUser, isJSON }) {
    if (isJSON && !isUser) return <pre className="code">{text}</pre>
    if (isUser) return text

    const blocks = []
    let list = null

    const flushList = () => {
      if (!list) return
      const Tag = list.type === 'number' ? 'ol' : 'ul'
      blocks.push(<Tag key={`list-${blocks.length}`} className="md-list">{list.items}</Tag>)
      list = null
    }

    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) {
        flushList()
        continue
      }

      const heading = line.match(/^\*\*(.+?)\*\*:?\s*$/)
      if (heading) {
        flushList()
        blocks.push(<div key={`h-${blocks.length}`} className="md-heading">{heading[1]}</div>)
        continue
      }

      const numbered = line.match(/^(\d+)[.)]\s+(.*)$/)
      if (numbered) {
        if (!list || list.type !== 'number') {
          flushList()
          list = { type: 'number', items: [] }
        }
        list.items.push(<li key={`li-${list.items.length}`}>{renderInline(numbered[2])}</li>)
        continue
      }

      const bullet = line.match(/^[-*]\s+(.*)$/)
      if (bullet) {
        if (!list || list.type !== 'bullet') {
          flushList()
          list = { type: 'bullet', items: [] }
        }
        list.items.push(<li key={`li-${list.items.length}`}>{renderInline(bullet[1])}</li>)
        continue
      }

      flushList()
      blocks.push(<p key={`p-${blocks.length}`} className="md-p">{renderInline(line)}</p>)
    }

    flushList()
    return <div className="md">{blocks}</div>
  }

  function renderInline(text) {
    return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={idx}>{part.slice(2, -2)}</strong>
      if (part.startsWith('`') && part.endsWith('`')) return <code key={idx}>{part.slice(1, -1)}</code>
      return part
    })
  }

  const canSend = !uploading && (input.trim().length > 0 || attachments.length > 0)

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Inter','SF Pro Text',system-ui,sans-serif;background:#eef4ff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
        .shell{display:flex;flex-direction:column;height:calc(100vh - 48px);width:min(100%,780px);margin:0 auto;background:#fff;border:1px solid #dbeafe;border-radius:18px;box-shadow:0 18px 60px rgba(37,99,235,.12);overflow:hidden}

        /* header */
        .hdr{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #e0edff;background:#fff;flex-shrink:0}
        .hdr-icon{width:34px;height:34px;border-radius:9px;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
        .hdr-title{font-size:14px;font-weight:600;color:#0f2848;letter-spacing:-0.2px}
        .hdr-sub{font-size:11px;color:#94b4cc;margin-top:1px}
        .pill{margin-left:auto;display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b;background:#f8fafc;border:1px solid #e2e8f0;padding:3px 9px;border-radius:20px;white-space:nowrap}
        .pdot{width:6px;height:6px;border-radius:50%;background:#94a3b8;flex-shrink:0}
        .pdot.on{background:#22c55e}

        /* messages */
        .msgs{flex:1;overflow-y:auto;padding:22px 24px 6px;display:flex;flex-direction:column;gap:14px;scroll-behavior:smooth}
        .msgs::-webkit-scrollbar{width:4px}
        .msgs::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}

        /* rows */
        .row{display:flex;gap:9px;align-items:flex-end;width:100%}
        .row.u{flex-direction:row-reverse;justify-content:flex-start}
        .row.sys{justify-content:center}
        .msg-wrap{width:min(72%,560px);display:flex;flex-direction:column;align-items:flex-start}
        .row.u .msg-wrap{align-items:flex-end}

        .av{width:26px;height:26px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
        .av.ai{background:#dbeafe;color:#1d4ed8}
        .av.me{background:#2563eb;color:#fff}

        .bbl{width:fit-content;max-width:100%;border-radius:15px;padding:9px 13px;font-size:13.5px;line-height:1.6;word-break:break-word}
        .bbl.ai{background:#f0f7ff;border:1px solid #dbeafe;color:#0f2848;border-bottom-left-radius:3px}
        .bbl.me{background:#2563eb;color:#fff;border-bottom-right-radius:3px}
        .bbl.sys{background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:11.5px;border-radius:8px;padding:5px 11px}
        .bbl.err{background:#fff1f2;border:1px solid #fecaca;color:#b91c1c}
        .md{display:flex;flex-direction:column;gap:9px}
        .md-heading{font-size:14px;font-weight:700;color:#0f2848;margin-top:2px}
        .md-p{margin:0}
        .md-list{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px}
        .md-list li{padding-left:2px}
        .md strong{font-weight:700;color:#0b1f3a}
        .md code{font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;background:#e6f0ff;border:1px solid #cfe1ff;border-radius:5px;padding:1px 5px;color:#1d4ed8}

        .lbl{font-size:10px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#93b4d0;margin-bottom:2px}
        .meta{font-size:10px;color:#b0c4d8;margin-top:3px;text-align:left}
        .row.u .meta{text-align:right}

        pre.code{font-family:'JetBrains Mono','Fira Code',monospace;font-size:11.5px;white-space:pre-wrap;background:rgba(0,0,0,0.04);border-radius:6px;padding:8px 10px;margin-top:5px;max-height:260px;overflow-y:auto}

        /* thinking */
        .thinking-row{display:flex;gap:9px;align-items:flex-end}
        .thinking{display:flex;gap:4px;align-items:center;padding:9px 13px;background:#f0f7ff;border:1px solid #dbeafe;border-radius:15px;border-bottom-left-radius:3px}
        .dot{width:6px;height:6px;border-radius:50%;background:#93c5fd;animation:bop 1.2s infinite ease-in-out}
        .dot:nth-child(2){animation-delay:.2s}
        .dot:nth-child(3){animation-delay:.4s}
        @keyframes bop{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-5px);opacity:1}}

        /* approval */
        .appr{margin:0 20px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;display:flex;align-items:center;gap:10px;font-size:12.5px;color:#78350f;flex-shrink:0}
        .appr strong{flex:1}
        .appr-btn{padding:5px 13px;background:#2563eb;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer}
        .appr-btn:hover{background:#1d4ed8}

        /* chips */
        .chips{display:flex;flex-wrap:wrap;gap:5px;padding:8px 20px 0;flex-shrink:0}
        .chip{display:flex;align-items:center;gap:5px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:20px;padding:3px 9px;font-size:11.5px;color:#1e40af;max-width:200px}
        .chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
        .chip-view{background:none;border:none;color:#3b82f6;font-size:11px;cursor:pointer;padding:0;flex-shrink:0}
        .chip-x{background:none;border:none;color:#93c5fd;font-size:14px;line-height:1;cursor:pointer;padding:0;flex-shrink:0;transition:color .15s}
        .chip-x:hover{color:#ef4444}

        /* input */
        .inp-wrap{padding:10px 20px 18px;flex-shrink:0;border-top:1px solid #e0edff;background:#fff}
        .inp-box{display:flex;align-items:flex-end;gap:7px;background:#f0f7ff;border:1.5px solid #bfdbfe;border-radius:13px;padding:7px 7px 7px 13px;transition:border-color .15s,box-shadow .15s}
        .inp-box:focus-within{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
        textarea.ti{flex:1;border:none;background:transparent;outline:none;resize:none;font-size:13.5px;line-height:1.5;color:#0f2848;font-family:inherit;max-height:130px;min-height:22px;overflow-y:auto}
        textarea.ti::placeholder{color:#94b4cc}
        .att-btn{width:30px;height:30px;border:none;background:transparent;color:#94b4cc;font-size:20px;font-weight:300;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0}
        .att-btn:hover{background:#dbeafe;color:#2563eb}
        .snd-btn{width:32px;height:32px;border:none;border-radius:8px;background:#2563eb;color:#fff;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .1s;flex-shrink:0}
        .snd-btn:hover:not(:disabled){background:#1d4ed8;transform:scale(1.05)}
        .snd-btn:disabled{background:#93c5fd;cursor:not-allowed}

        /* file panel */
        .overlay{position:fixed;inset:0;background:rgba(10,25,55,.35);display:flex;align-items:center;justify-content:center;z-index:200;padding:24px}
        .fpanel{background:#fff;border-radius:14px;border:1px solid #dbeafe;padding:18px;max-width:540px;width:100%;max-height:78vh;overflow-y:auto;box-shadow:0 16px 48px rgba(37,99,235,.14)}
        .fpanel-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
        .fpanel-name{font-size:13px;font-weight:600;color:#0f2848}
        .fpanel-close{background:none;border:none;color:#94b4cc;font-size:20px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1;transition:background .15s}
        .fpanel-close:hover{background:#f1f5f9;color:#64748b}
        .fpanel pre{font-family:'JetBrains Mono',monospace;font-size:11.5px;white-space:pre-wrap;color:#0f2848;background:#f0f7ff;border-radius:8px;padding:11px;border:1px solid #dbeafe}
        @media (max-width:720px){body{padding:0;align-items:stretch}.shell{height:100vh;width:100%;border:none;border-radius:0}.msg-wrap{width:82%}.msgs{padding:18px 16px 6px}}
      `}</style>

      <div className="shell">
        {/* Header */}
        <div className="hdr">
          <div className="hdr-icon">AI</div>
          <div>
            <div className="hdr-title">AI Embedded Agent</div>
            <div className="hdr-sub">Interactive code analysis agent</div>
          </div>
          <div className="pill">
            <span className={`pdot ${connected ? 'on' : ''}`} />
            {connected ? 'Connected' : 'Offline'}
            {chatModel?.model ? ` · ${chatModel.model}` : ''}
          </div>
        </div>

        {/* Messages */}
        <div className="msgs" ref={messagesRef}>
          {messages.map((m, i) => {
            const isSys = m.type === 'SYSTEM'
            const isErr = m.type === 'ERROR'
            const isUser = m.sender === 'user'
            const isJSON = m.text?.trim().startsWith('{') || m.text?.trim().startsWith('[')
            const label = labelType(m.type)

            if (isSys) return (
              <div key={i} className="row sys">
                <div className="bbl sys">{m.text}</div>
              </div>
            )

            return (
              <div key={i} className={`row ${isUser ? 'u' : ''}`}>
                <div className={`av ${isUser ? 'me' : 'ai'}`}>{isUser ? 'U' : 'AI'}</div>
                <div className="msg-wrap">
                  {!isUser && label && <div className="lbl">{label}</div>}
                  <div className={`bbl ${isUser ? 'me' : isErr ? 'err' : 'ai'}`}>
                    {renderMessageText(m.text, { isUser, isJSON })}
                  </div>
                  <div className="meta">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            )
          })}

          {thinking && (
            <div className="thinking-row">
              <div className="av ai">AI</div>
              <ThinkingIndicator />
            </div>
          )}
        </div>

        {/* Approval */}
        {pendingApproval && (
          <div className="appr">
            <strong>Approval needed: {pendingApproval.action || pendingApproval.type}</strong>
            <button className="appr-btn" onClick={approveFlash}>Approve</button>
          </div>
        )}

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="chips">
            {attachments.map((a, idx) => (
              <div key={idx} className="chip">
                <span className="chip-name">{a.file.name}</span>
                <button className="chip-view" onClick={() => setOpenFile({ ...a, idx })}>view</button>
                <button className="chip-x" onClick={() => setAttachments(prev => prev.filter((_, j) => j !== idx))}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="inp-wrap">
          <div className="inp-box">
            <button type="button" className="att-btn" onClick={() => fileRef.current?.click()} title="Attach file">+</button>
            <textarea
              ref={textareaRef}
              className="ti"
              rows={1}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 130) + 'px'
              }}
              onKeyDown={handleKeyDown}
              placeholder="Type a goal or paste code… (Enter to send)"
            />
            <button className="snd-btn" onClick={handleSubmit} disabled={!canSend} title="Send">↑</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".c,.h,.cpp,.cc,.py,.m,.js,.ts,.json,.txt,.ino,.java,.rs,.go,.sh,image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* File panel overlay */}
      {openFile && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setOpenFile(null)}>
          <div className="fpanel">
            <div className="fpanel-hdr">
              <span className="fpanel-name">{openFile.file.name}</span>
              <button className="fpanel-close" onClick={() => setOpenFile(null)}>×</button>
            </div>
            {openFile.type === 'image'
              ? <img src={openFile.preview} alt={openFile.file.name} style={{ maxWidth: '100%', borderRadius: 8 }} />
              : <pre>{openFile.previewText || '(no preview)'}</pre>
            }
          </div>
        </div>
      )}
    </>
  )
}

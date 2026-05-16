import React, { useEffect, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'
const FIRST_CHAT_ID = 1

function ThinkingIndicator() {
  return (
    <div className="thinking">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
    </div>
  )
}

function makeChatTitle(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/#+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!clean) return 'New Chat'

  const words = clean.split(' ').slice(0, 7).join(' ')
  return words.length > 42 ? `${words.slice(0, 42)}…` : words
}

function makePreview(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/[#*_`>\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return clean.length > 72 ? `${clean.slice(0, 72)}…` : clean || 'No messages yet.'
}

function cleanAIText(text) {
  return String(text || '')
    .replace(/```(\w+)?\s*\n([\s\S]*?)\n?`\s*$/gm, '```$1\n$2\n```')
    .replace(/\n`\s*$/gm, '\n```')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function App() {
  const ws = useRef(null)
  const fileRef = useRef(null)
  const messagesRef = useRef(null)
  const textareaRef = useRef(null)
  const activeChatIdRef = useRef(FIRST_CHAT_ID)
  const responseChatIdRef = useRef(FIRST_CHAT_ID)
  const pendingResponseChatIdsRef = useRef([])

  const [connected, setConnected] = useState(false)
  const [activeChatId, setActiveChatId] = useState(FIRST_CHAT_ID)
  const [messagesByChat, setMessagesByChat] = useState({ [FIRST_CHAT_ID]: [] })
  const [input, setInput] = useState('')
  const [pendingApproval, setPendingApproval] = useState(null)
  const [agentStartedByChat, setAgentStartedByChat] = useState({})
  const [uploading, setUploading] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [chatModel, setChatModel] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [openFile, setOpenFile] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chatSessions, setChatSessions] = useState([
    {
      id: FIRST_CHAT_ID,
      title: 'New Chat',
      preview: 'Start a new chat.',
      time: 'Now',
    },
  ])

  const messages = messagesByChat[activeChatId] || []
  const canSend = !uploading && (input.trim().length > 0 || attachments.length > 0)

  useEffect(() => {
    activeChatIdRef.current = activeChatId
  }, [activeChatId])

  function setActiveChat(id) {
    setActiveChatId(id)
    activeChatIdRef.current = id
    setInput('')
    setAttachments([])
    setPendingApproval(null)
    setThinking(false)
  }

  function appendMessage(chatId, message) {
    setMessagesByChat(prev => ({
      ...prev,
      [chatId]: [...(prev[chatId] || []), message],
    }))
  }

  function updateChatMeta(chatId, { title, preview, time = 'Now' }) {
    setChatSessions(prev =>
      prev.map(chat => {
        if (chat.id !== chatId) return chat
        return {
          ...chat,
          title: title ?? chat.title,
          preview: preview ?? chat.preview,
          time,
        }
      })
    )
  }

  function getMessageChatId(msg) {
    return (
      msg?.chatId ||
      msg?.clientChatId ||
      msg?.payload?.chatId ||
      msg?.payload?.clientChatId ||
      pendingResponseChatIdsRef.current[0] ||
      activeChatIdRef.current
    )
  }

  function consumePendingChatId(chatId) {
    const queue = pendingResponseChatIdsRef.current
    const index = queue.indexOf(chatId)

    if (index !== -1) {
      queue.splice(index, 1)
      return
    }

    if (queue.length > 0) queue.shift()
  }

  function pushEvent(type, payload, targetChatId = null) {
    const chatId = targetChatId ?? getMessageChatId(null)
    const text = typeof payload === 'string' ? payload : payload?.message ?? JSON.stringify(payload)

    appendMessage(chatId, {
      sender: 'assistant',
      type,
      text,
      ts: Date.now(),
    })

    updateChatMeta(chatId, { preview: makePreview(text) })
    setThinking(false)
  }

  function send(msg, chatId = activeChatIdRef.current) {
    const messageWithChatId = {
      ...msg,
      chatId,
      clientChatId: chatId,
      payload: {
        ...(msg.payload || {}),
        chatId,
        clientChatId: chatId,
      },
    }

    try {
      if (!ws.current) return

      if (ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(messageWithChatId))
      } else {
        ws.current.__sendQueue = ws.current.__sendQueue || []
        ws.current.__sendQueue.push(messageWithChatId)
      }
    } catch (err) {
      console.error('send error', err)
    }
  }

  useEffect(() => {
    if (!messagesRef.current) return
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages, thinking, attachments])

  useEffect(() => {
    let reconnectTimer
    let shouldReconnect = true

    function addSystemMessage(text) {
      const chatId = activeChatIdRef.current

      setMessagesByChat(prev => {
        const current = prev[chatId] || []
        const last = current[current.length - 1]
        if (last?.type === 'SYSTEM' && last?.text === text) return prev

        return {
          ...prev,
          [chatId]: [...current, { sender: 'assistant', type: 'SYSTEM', text, ts: Date.now() }],
        }
      })

      updateChatMeta(chatId, { preview: text })
    }

    function connectSocket() {
      const socket = new WebSocket(WS_URL)
      ws.current = socket

      socket.onopen = () => {
        setConnected(true)
        addSystemMessage('Connected — send a goal to begin.')

        if (socket.__sendQueue?.length) {
          socket.__sendQueue.forEach(m => socket.send(JSON.stringify(m)))
          socket.__sendQueue = []
        }
      }

      socket.onmessage = e => {
        let msg
        try {
          msg = JSON.parse(e.data)
        } catch {
          msg = { type: 'RAW', message: e.data }
        }

        const targetChatId = getMessageChatId(msg)

        if (msg.type === 'SERIAL_LINE') {
          pushEvent('SERIAL_LINE', msg.data, targetChatId)
          return
        }

        if (msg.type === 'AWAITING_APPROVAL') {
          setPendingApproval({ ...msg, chatId: targetChatId })
          return
        }

        if (msg.model) setChatModel(msg.model)
        if (msg.type === 'CONNECTED') return
        if (msg.type === 'THINKING') return

        pushEvent(msg.type || 'MSG', msg.message || JSON.stringify(msg), targetChatId)
        consumePendingChatId(targetChatId)
      }

      socket.onclose = () => {
        setConnected(false)
        addSystemMessage('Disconnected — reconnecting…')
        if (shouldReconnect) reconnectTimer = setTimeout(connectSocket, 2000)
      }

      socket.onerror = err => {
        console.error('WebSocket error:', err)
        setConnected(false)
      }
    }

    connectSocket()

    return () => {
      shouldReconnect = false
      clearTimeout(reconnectTimer)
      ws.current?.close()
    }
  }, [])

  function startNewChat() {
    const id = Date.now()

    setMessagesByChat(prev => ({ ...prev, [id]: [] }))
    setChatSessions(prev => [
      {
        id,
        title: 'New Chat',
        preview: 'Start a new chat.',
        time: 'Now',
      },
      ...prev,
    ])

    setActiveChat(id)
    setAgentStartedByChat(prev => ({ ...prev, [id]: false }))
  }

  async function handleSubmit(e) {
    e?.preventDefault()

    const chatId = activeChatId
    const hasText = input.trim().length > 0
    if (!hasText && attachments.length === 0) return

    const text = input.trim()
    const now = Date.now()

    if (hasText) {
      appendMessage(chatId, { sender: 'user', text, ts: now })

      const currentChat = chatSessions.find(chat => chat.id === chatId)
      updateChatMeta(chatId, {
        title: currentChat?.title === 'New Chat' ? makeChatTitle(text) : currentChat?.title,
        preview: makePreview(text),
      })

      setInput('')
      setThinking(true)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } else {
      const fileText = attachments.map(a => a.file.name).join(', ')
      appendMessage(chatId, { sender: 'user', text: fileText, ts: now })
      updateChatMeta(chatId, {
        title: makeChatTitle(fileText),
        preview: makePreview(fileText),
      })
    }

    if (attachments.length > 0) {
      const fd = new FormData()
      let code = ''

      for (const a of attachments) {
        if (a.type === 'image') {
          fd.append('image', a.file)
        } else {
          code += `\n// ---- ${a.file.name} ----\n${a.file ? await a.file.text() : ''}\n`
        }
      }

      if (code) fd.append('code', code)
      fd.append('components', text)

      try {
        setUploading(true)
        const resp = await fetch('/api/debug', { method: 'POST', body: fd })
        const json = await resp.json()
        const responseText = JSON.stringify(json, null, 2)
        appendMessage(chatId, { sender: 'assistant', text: responseText, ts: Date.now() })
        updateChatMeta(chatId, { preview: makePreview(responseText) })
      } catch (err) {
        const errorText = `Upload failed: ${err.message}`
        appendMessage(chatId, { sender: 'assistant', type: 'ERROR', text: errorText, ts: Date.now() })
        updateChatMeta(chatId, { preview: errorText })
      } finally {
        setUploading(false)
        setAttachments([])
      }
    }

    if (hasText) {
      responseChatIdRef.current = chatId
      pendingResponseChatIdsRef.current.push(chatId)

      if (!agentStartedByChat[chatId]) {
        send({ type: 'START_AGENT', payload: { goal: text } })
        setAgentStartedByChat(prev => ({ ...prev, [chatId]: true }))
      } else {
        send({ type: 'USER_PROMPT', payload: { text } })
      }
    } else {
      responseChatIdRef.current = chatId
      pendingResponseChatIdsRef.current.push(chatId)
      send({ type: 'USER_ATTACHMENT', payload: { files: attachments.map(a => a.file.name) } })
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function approveFlash() {
    send({ type: 'APPROVE_FLASH' }, pendingApproval?.chatId || activeChatId)
    setPendingApproval(null)
  }

  async function handleFileChange(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    const next = []

    for (const file of files) {
      if (file.type?.startsWith('image/')) {
        const dataUrl = await new Promise((res, rej) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result)
          fr.onerror = rej
          fr.readAsDataURL(file)
        })
        next.push({ file, preview: dataUrl, type: 'image' })
      } else {
        let text = ''
        try {
          text = await file.text()
        } catch {
          text = ''
        }
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

  function renderInline(text) {
    const parts = String(text).split(/(\[[^\]]+\]\([^\)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)

    return parts.map((part, idx) => {
      const link = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/)
      if (link) {
        return (
          <a key={idx} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        )
      }

      if (part.startsWith('**') && part.endsWith('**')) return <strong key={idx}>{part.slice(2, -2)}</strong>
      if (part.startsWith('`') && part.endsWith('`')) return <code key={idx}>{part.slice(1, -1)}</code>
      return part
    })
  }

  function renderMessageText(text, { isUser, isJSON }) {
    if (isUser) return text

    const safeText = cleanAIText(text)

    if (isJSON) {
      return <pre className="code">{safeText}</pre>
    }

    const blocks = []
    let list = null
    let codeBlock = null

    const flushList = () => {
      if (!list) return
      const Tag = list.type === 'number' ? 'ol' : 'ul'
      blocks.push(
        <Tag key={`list-${blocks.length}`} className="md-list">
          {list.items}
        </Tag>
      )
      list = null
    }

    const flushCode = () => {
      if (!codeBlock) return
      blocks.push(
        <div key={`codewrap-${blocks.length}`} className="code-wrap">
          {codeBlock.lang && <div className="code-lang">{codeBlock.lang}</div>}
          <pre className="code-block"><code>{codeBlock.lines.join('\n').trim()}</code></pre>
        </div>
      )
      codeBlock = null
    }

    for (const rawLine of safeText.split(/\r?\n/)) {
      const line = rawLine.trimEnd()
      const trimmed = line.trim()

      const codeFence = trimmed.match(/^```\s*([a-zA-Z0-9_-]+)?\s*$/)
      if (codeFence) {
        if (codeBlock) {
          flushCode()
        } else {
          flushList()
          codeBlock = { lang: codeFence[1] || '', lines: [] }
        }
        continue
      }

      if (codeBlock) {
        codeBlock.lines.push(rawLine)
        continue
      }

      if (!trimmed || trimmed === '---') {
        flushList()
        if (trimmed === '---') blocks.push(<hr key={`hr-${blocks.length}`} className="md-hr" />)
        continue
      }

      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
      if (heading) {
        flushList()
        const level = heading[1].length
        blocks.push(
          <div key={`h-${blocks.length}`} className={`md-heading h${level}`}>
            {renderInline(heading[2])}
          </div>
        )
        continue
      }

      const boldHeading = trimmed.match(/^\*\*(.+?)\*\*:?\s*$/)
      if (boldHeading) {
        flushList()
        blocks.push(
          <div key={`bh-${blocks.length}`} className="md-heading h3">
            {renderInline(boldHeading[1])}
          </div>
        )
        continue
      }

      const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/)
      if (numbered) {
        if (!list || list.type !== 'number') {
          flushList()
          list = { type: 'number', items: [] }
        }
        list.items.push(<li key={`li-${list.items.length}`}>{renderInline(numbered[2])}</li>)
        continue
      }

      const bullet = trimmed.match(/^[-*•]\s+(.*)$/)
      if (bullet) {
        if (!list || list.type !== 'bullet') {
          flushList()
          list = { type: 'bullet', items: [] }
        }
        list.items.push(<li key={`li-${list.items.length}`}>{renderInline(bullet[1])}</li>)
        continue
      }

      flushList()
      blocks.push(
        <p key={`p-${blocks.length}`} className="md-p">
          {renderInline(trimmed)}
        </p>
      )
    }

    flushList()
    flushCode()

    return <div className="md">{blocks}</div>
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --sidebar-w: 250px;
          --panel-w: 320px;
          --radius-lg: 16px;
          --radius-md: 12px;
          --radius-sm: 8px;
          --radius-xs: 6px;
          --bg: #ffffff;
          --bg2: #f5f5f7;
          --bg3: #ebebed;
          --bg4: #d1d1d6;
          --accent: #007aff;
          --accent2: #34c759;
          --text: #1c1c1e;
          --text2: #48484a;
          --text3: #8e8e93;
          --border: rgba(0, 0, 0, 0.08);
          --font: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
          --font-mono: 'SF Mono', 'Fira Code', Consolas, monospace;
        }

        html, body, #root {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          overflow: hidden;
          background: var(--bg);
          font-family: var(--font);
          color: var(--text);
          -webkit-font-smoothing: antialiased;
        }

        button, textarea, input { font-family: inherit; }
        .app { display: flex; width: 100vw; height: 100vh; overflow: hidden; background: var(--bg); }

        .sidebar {
          width: var(--sidebar-w);
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          background: rgba(245, 245, 247, 0.95);
          border-right: 1px solid var(--border);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s;
          overflow: hidden;
        }

        .sidebar.collapsed { width: 0; opacity: 0; pointer-events: none; }

        .sidebar-header {
          padding: 10px 14px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }

        .sidebar-title { font-size: 18px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }

        .new-chat-btn {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--bg3);
          border: 1px solid var(--border);
          color: var(--text2);
          font-size: 18px;
          font-weight: 300;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          line-height: 1;
        }

        .new-chat-btn:hover { background: var(--accent); color: #fff; border-color: transparent; }

        .sidebar-search {
          margin: 0 10px 8px;
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          flex-shrink: 0;
        }

        .sidebar-search input {
          background: none;
          border: none;
          outline: none;
          color: var(--text);
          font-size: 12.5px;
          width: 100%;
        }

        .sidebar-search input::placeholder, .search-ico { color: var(--text3); }

        .chat-list { flex: 1; overflow-y: auto; padding: 4px 6px 10px; }
        .chat-list::-webkit-scrollbar, .msgs::-webkit-scrollbar, .file-panel-body::-webkit-scrollbar { width: 3px; }
        .chat-list::-webkit-scrollbar-thumb, .msgs::-webkit-scrollbar-thumb, .file-panel-body::-webkit-scrollbar-thumb { background: var(--bg4); border-radius: 3px; }

        .date-divider {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 10.5px;
          font-weight: 500;
          color: var(--text3);
          letter-spacing: 0.04em;
        }

        .date-divider::before, .date-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }

        .chat-item {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 10px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background 0.12s;
          position: relative;
          overflow: hidden;
        }

        .chat-item:hover, .chat-item.active { background: var(--bg3); }
        .chat-item.active::before {
          content: '';
          position: absolute;
          left: 0;
          top: 20%;
          bottom: 20%;
          width: 2.5px;
          background: var(--accent);
          border-radius: 0 2px 2px 0;
        }

        .chat-item-row { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; }
        .chat-item-title { font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .chat-item-time { font-size: 10px; color: var(--text3); flex-shrink: 0; }
        .chat-item-preview { font-size: 11px; color: var(--text3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .sidebar-footer { border-top: 1px solid var(--border); padding: 10px 12px 12px; flex-shrink: 0; }
        .model-chip { display: flex; align-items: center; gap: 7px; background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 7px 9px; }
        .model-chip-avatar { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0; }
        .model-chip-text { flex: 1; overflow: hidden; }
        .model-chip-name { font-size: 11.5px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .model-chip-sub { font-size: 10px; color: var(--text3); }
        .conn-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text3); flex-shrink: 0; transition: background 0.3s; }
        .conn-dot.on { background: var(--accent2); box-shadow: 0 0 6px var(--accent2); }

        .main { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg); position: relative; }

        .titlebar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 16px;
          border-bottom: 1px solid var(--border);
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          flex-shrink: 0;
          min-height: 44px;
        }

        .sidebar-toggle, .tb-icon-btn {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-xs);
          background: none;
          border: none;
          color: var(--text2);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: background 0.12s, color 0.12s;
          flex-shrink: 0;
        }

        .sidebar-toggle:hover, .tb-icon-btn:hover { background: var(--bg3); color: var(--text); }
        .titlebar-center { flex: 1; text-align: center; }
        .titlebar-name { font-size: 13.5px; font-weight: 600; color: var(--text); letter-spacing: -0.2px; }
        .titlebar-sub { font-size: 11px; color: var(--text3); margin-top: 1px; }
        .tb-right { display: flex; align-items: center; gap: 6px; }
        .conn-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text3); background: var(--bg2); border: 1px solid var(--border); padding: 3px 8px; border-radius: 20px; }

        .msgs { flex: 1; overflow-y: auto; padding: 12px 24px 12px; display: flex; flex-direction: column; gap: 16px; scroll-behavior: smooth; }
        .empty-chat { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text3); font-size: 13px; text-align: center; padding: 24px; }
        .row { display: flex; gap: 8px; align-items: flex-end; width: 100%; }
        .row.u { flex-direction: row-reverse; }
        .row.sys { justify-content: center; }
        .msg-wrap { max-width: min(78%, 760px); display: flex; flex-direction: column; align-items: flex-start; }
        .row.u .msg-wrap { align-items: flex-end; }

        .av { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; letter-spacing: 0.02em; }
        .av.ai { background: linear-gradient(135deg, #007aff, #5e5ce6); color: #fff; box-shadow: 0 2px 8px rgba(0, 122, 255, 0.25); }
        .av.me { background: var(--bg3); border: 1px solid var(--border); color: var(--text2); }

        .bbl { width: fit-content; max-width: 100%; border-radius: 16px; padding: 10px 14px; font-size: 13.5px; line-height: 1.6; word-break: break-word; }
        .bbl.ai { background: var(--bg2); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 4px; }
        .bbl.me { background: var(--accent); color: #fff; border-bottom-right-radius: 4px; box-shadow: 0 2px 10px rgba(10, 132, 255, 0.3); }
        .bbl.sys { background: var(--bg2); border: 1px solid var(--border); color: var(--text3); font-size: 11.5px; border-radius: 8px; padding: 4px 10px; }
        .bbl.err { background: rgba(255, 69, 58, 0.12); border: 1px solid rgba(255, 69, 58, 0.25); color: #ff453a; }

        .md { display: flex; flex-direction: column; gap: 10px; }
        .md-heading { color: var(--text); line-height: 1.25; letter-spacing: -0.2px; }
        .md-heading.h1 { font-size: 18px; font-weight: 700; margin-top: 2px; }
        .md-heading.h2 { font-size: 16px; font-weight: 700; margin-top: 2px; }
        .md-heading.h3, .md-heading.h4 { font-size: 14.5px; font-weight: 650; margin-top: 4px; }
        .md-p { margin: 0; color: var(--text); }
        .md-list { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 6px; }
        .md-list li { padding-left: 3px; color: var(--text); }
        .md strong { font-weight: 650; color: var(--text); }
        .md a { color: var(--accent); text-decoration: none; font-weight: 500; }
        .md a:hover { text-decoration: underline; }
        .md code { font-family: var(--font-mono); font-size: 12px; background: rgba(10, 132, 255, 0.12); border: 1px solid rgba(10, 132, 255, 0.2); border-radius: 5px; padding: 1px 5px; color: var(--accent); }
        .md-hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; }

        .code-wrap { overflow: hidden; border-radius: 12px; border: 1px solid var(--border); background: #f0f0f3; }
        .code-lang { padding: 6px 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text3); border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.55); }
        .code-block { margin: 0; padding: 12px; overflow-x: auto; white-space: pre; font-family: var(--font-mono); font-size: 12px; line-height: 1.55; color: var(--text); }

        .lbl { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text3); margin-bottom: 3px; }
        .meta { font-size: 10px; color: var(--text3); margin-top: 4px; }
        .row.u .meta { text-align: right; }

        pre.code { font-family: var(--font-mono); font-size: 11.5px; white-space: pre-wrap; background: var(--bg3); border-radius: var(--radius-sm); padding: 8px 10px; margin-top: 4px; max-height: 240px; overflow-y: auto; color: var(--text2); border: 1px solid var(--border); }

        .thinking-row { display: flex; gap: 8px; align-items: flex-end; }
        .thinking { display: flex; gap: 5px; align-items: center; padding: 10px 14px; background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; border-bottom-left-radius: 4px; }
        .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: 0.5; animation: bop 1.2s infinite ease-in-out; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bop { 0%, 80%, 100% { transform: translateY(0); opacity: 0.35; } 40% { transform: translateY(-4px); opacity: 1; } }

        .appr { margin: 0 16px; padding: 10px 14px; background: rgba(255, 159, 10, 0.1); border: 1px solid rgba(255, 159, 10, 0.25); border-radius: var(--radius-md); display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: #ff9f0a; flex-shrink: 0; backdrop-filter: blur(10px); }
        .appr strong { flex: 1; }
        .appr-btn { padding: 5px 14px; background: var(--accent); color: #fff; border: none; border-radius: var(--radius-xs); font-size: 12px; font-weight: 600; cursor: pointer; }

        .chips { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 16px 0; flex-shrink: 0; }
        .chip { display: flex; align-items: center; gap: 6px; background: rgba(10, 132, 255, 0.1); border: 1px solid rgba(10, 132, 255, 0.2); border-radius: 20px; padding: 3px 10px; font-size: 11.5px; color: var(--accent); max-width: 200px; }
        .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
        .chip-view, .chip-x { background: none; border: none; cursor: pointer; padding: 0; flex-shrink: 0; }
        .chip-view { color: var(--accent); font-size: 11px; opacity: 0.7; }
        .chip-x { color: var(--text3); font-size: 14px; line-height: 1; }

        .inp-wrap { padding: 10px 16px 28px; flex-shrink: 0; border-top: 1px solid var(--border); background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
        .inp-box { display: flex; align-items: flex-end; gap: 6px; background: var(--bg2); border: 1.5px solid var(--border); border-radius: var(--radius-lg); padding: 7px 7px 7px 12px; transition: border-color 0.15s, box-shadow 0.15s; }
        .inp-box:focus-within { border-color: rgba(10, 132, 255, 0.5); box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.1); }
        textarea.ti { flex: 1; border: none; background: transparent; outline: none; resize: none; font-size: 13.5px; line-height: 1.5; color: var(--text); max-height: 130px; min-height: 22px; overflow-y: auto; }
        textarea.ti::placeholder { color: var(--text3); }
        .att-btn { width: 30px; height: 30px; border: 1px solid var(--border); background: var(--bg3); color: var(--text3); font-size: 18px; font-weight: 300; border-radius: var(--radius-xs); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .snd-btn { width: 32px; height: 32px; border: none; border-radius: 10px; background: var(--accent); color: #fff; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(10, 132, 255, 0.4); }
        .snd-btn:disabled { background: var(--bg3); box-shadow: none; cursor: not-allowed; color: var(--text3); }

        .file-panel { width: var(--panel-w); flex-shrink: 0; display: flex; flex-direction: column; background: rgba(245, 245, 247, 0.95); border-left: 1px solid var(--border); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s; overflow: hidden; }
        .file-panel.hidden { width: 0; opacity: 0; pointer-events: none; }
        .file-panel-header { display: flex; align-items: center; gap: 8px; padding: 14px 14px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .file-panel-title { font-size: 12.5px; font-weight: 600; color: var(--text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .file-panel-ext { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; color: var(--text3); text-transform: uppercase; flex-shrink: 0; }
        .file-panel-close { width: 22px; height: 22px; border-radius: 50%; background: rgba(255, 69, 58, 0.2); border: none; color: #ff453a; font-size: 11px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .file-panel-body { flex: 1; overflow-y: auto; padding: 12px; }
        .file-panel-body pre { font-family: var(--font-mono); font-size: 11.5px; white-space: pre-wrap; color: var(--text2); line-height: 1.65; background: var(--bg2); border-radius: var(--radius-sm); padding: 12px; border: 1px solid var(--border); }
        .file-panel-body img { max-width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--border); }
        .file-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; color: var(--text3); padding: 24px; text-align: center; }
        .file-empty-icon { font-size: 32px; margin-bottom: 4px; opacity: 0.4; }
        .file-empty-text { font-size: 12px; line-height: 1.5; }

        @media (max-width: 768px) {
          :root { --sidebar-w: 220px; --panel-w: 260px; }
          .msgs { padding: 8px 14px 8px; }
          .titlebar { padding: 8px 12px; }
          .inp-wrap { padding: 10px 12px 28px; }
          .msg-wrap { max-width: 84%; }
        }

        @media (max-width: 560px) {
          .sidebar, .file-panel { position: absolute; z-index: 100; height: 100%; }
          .sidebar { border-radius: 0 var(--radius-lg) var(--radius-lg) 0; }
          .file-panel { right: 0; border-radius: var(--radius-lg) 0 0 var(--radius-lg); }
        }
      `}</style>

      <div className="app">
        <div className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
          <div className="sidebar-header">
            <span className="sidebar-title">Chats</span>
            <button className="new-chat-btn" type="button" title="New chat" onClick={startNewChat}>+</button>
          </div>

          <div className="sidebar-search">
            <span className="search-ico">⌕</span>
            <input type="text" placeholder="Search" />
          </div>

          <div className="chat-list">
            <div className="date-divider" style={{ margin: '4px 4px 8px', fontSize: '9.5px' }}>Today</div>

            {chatSessions.map(chat => (
              <div
                key={chat.id}
                className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}
                onClick={() => setActiveChat(chat.id)}
              >
                <div className="chat-item-row">
                  <span className="chat-item-title">{chat.title}</span>
                  <span className="chat-item-time">{chat.time}</span>
                </div>
                <span className="chat-item-preview">{chat.preview}</span>
              </div>
            ))}
          </div>

          <div className="sidebar-footer">
            <div className="model-chip">
              <div className="model-chip-avatar">AI</div>
              <div className="model-chip-text">
                <div className="model-chip-name">{chatModel?.model || 'AI Agent'}</div>
                <div className="model-chip-sub">Embedded · Agentic</div>
              </div>
              <div className={`conn-dot ${connected ? 'on' : ''}`} title={connected ? 'Connected' : 'Offline'} />
            </div>
          </div>
        </div>

        <div className="main">
          <div className="titlebar">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(s => !s)} title="Toggle sidebar">☰</button>

            <div className="titlebar-center">
              <div className="titlebar-name">AI Embedded Agent</div>
              <div className="titlebar-sub">Interactive code analysis</div>
            </div>

            <div className="tb-right">
              <div className="conn-badge">
                <div className={`conn-dot ${connected ? 'on' : ''}`} />
                {connected ? 'Live' : 'Offline'}
              </div>

              {openFile ? (
                <button className="tb-icon-btn" onClick={() => setOpenFile(null)} title="Close file panel">✕</button>
              ) : null}
            </div>
          </div>

          <div className="msgs" ref={messagesRef}>
            <div className="date-divider">Today</div>

            {messages.length === 0 && !thinking ? (
              <div className="empty-chat">Start a new message. The chat name will automatically become a short summary of your first prompt.</div>
            ) : null}

            {messages.map((m, i) => {
              const isSys = m.type === 'SYSTEM'
              const isErr = m.type === 'ERROR'
              const isUser = m.sender === 'user'
              const isJSON = m.text?.trim().startsWith('{') || m.text?.trim().startsWith('[')
              const label = labelType(m.type)

              if (isSys) {
                return (
                  <div key={i} className="row sys">
                    <div className="bbl sys">{m.text}</div>
                  </div>
                )
              }

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

          {pendingApproval && (
            <div className="appr">
              <strong>⚠ Approval needed: {pendingApproval.action || pendingApproval.type}</strong>
              <button className="appr-btn" onClick={approveFlash}>Approve</button>
            </div>
          )}

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
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`
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

        <div className={`file-panel ${openFile ? '' : 'hidden'}`}>
          {openFile ? (
            <>
              <div className="file-panel-header">
                <span className="file-panel-ext">{openFile.file.name.split('.').pop() || 'file'}</span>
                <span className="file-panel-title">{openFile.file.name}</span>
                <button className="file-panel-close" onClick={() => setOpenFile(null)}>✕</button>
              </div>

              <div className="file-panel-body">
                {openFile.type === 'image' ? (
                  <img src={openFile.preview} alt={openFile.file.name} />
                ) : (
                  <pre>{openFile.previewText || '(no preview)'}</pre>
                )}
              </div>
            </>
          ) : (
            <div className="file-empty">
              <div className="file-empty-icon">⌗</div>
              <div className="file-empty-text">No file open.<br />Click "view" on an attachment to preview it here.</div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

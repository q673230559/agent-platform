import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { botsApi, conversationsApi, chatStream } from '../api/client'
import type { Bot, Conversation, Message } from '../types'

interface DisplayMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: unknown[]
  isStreaming?: boolean
}

export default function Chat() {
  const { botId } = useParams()
  const nav = useNavigate()
  const botIdNum = Number(botId)

  const [bot, setBot] = useState<Bot | null>(null)
  const [convs, setConvs] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const scrollToBottom = () => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })

  // Load bot info and conversations
  useEffect(() => {
    if (!botIdNum) return
    botsApi.get(botIdNum).then(setBot).catch(() => nav('/bots'))
    conversationsApi.list(botIdNum).then(setConvs)
  }, [botIdNum])

  // Scroll on new messages
  useEffect(() => { scrollToBottom() }, [messages])

  const loadMessages = useCallback(async (convId: number) => {
    const msgs = await conversationsApi.messages(convId)
    setMessages(msgs.map(m => ({ role: m.role as DisplayMessage['role'], content: m.content, tool_calls: m.tool_calls || undefined })))
    scrollToBottom()
  }, [])

  const selectConv = async (conv: Conversation) => {
    setActiveConv(conv)
    loadMessages(conv.id)
  }

  const newConv = async () => {
    if (!botIdNum) return
    const conv = await conversationsApi.create(botIdNum)
    setConvs(prev => [conv, ...prev])
    setActiveConv(conv)
    setMessages([])
  }

  const send = async () => {
    if (!input.trim() || streaming || !bot) return

    const userMsg: DisplayMessage = { role: 'user', content: input.trim() }
    const assistantMsg: DisplayMessage = { role: 'assistant', content: '', isStreaming: true }
    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)

    // Create conversation if needed
    let convId = activeConv?.id
    if (!convId) {
      const conv = await conversationsApi.create(bot.id)
      setConvs(prev => [conv, ...prev])
      setActiveConv(conv)
      convId = conv.id
    }

    abortRef.current = chatStream(
      bot.id,
      { conversation_id: convId, message: userMsg.content },
      (token) => {
        setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last.role === 'assistant') {
            last.content += token
          }
          return [...next]
        })
      },
      (data) => {
        setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last.role === 'assistant') {
            if (!last.tool_calls) last.tool_calls = []
            last.tool_calls.push(data)
          }
          return [...next]
        })
      },
      (full, toolCalls) => {
        setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last.role === 'assistant') {
            last.content = full
            last.isStreaming = false
            last.tool_calls = toolCalls
          }
          return [...next]
        })
        setStreaming(false)
        // Refresh conversation list and messages
        conversationsApi.list(bot.id).then(setConvs)
        if (convId) loadMessages(convId)
      },
      (err) => {
        setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last.role === 'assistant') {
            last.content = `Error: ${err}`
            last.isStreaming = false
          }
          return [...next]
        })
        setStreaming(false)
      },
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  if (!bot) {
    return (
      <div className="p-8">
        <p className="text-gray-400">Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-800">
          <button onClick={newConv} className="w-full text-left px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-400 text-sm font-medium hover:bg-indigo-600/30 transition-colors">
            + New Chat
          </button>
        </div>
        <div className="p-2 border-b border-gray-800">
          <button onClick={() => nav('/bots')} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 transition-colors">&larr; Back to Bots</button>
          <p className="text-xs text-gray-400 px-2 mt-1 truncate">{bot.name}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {convs.map(c => (
            <button
              key={c.id}
              onClick={() => selectConv(c)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${
                activeConv?.id === c.id
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`}
            >
              {c.title}
            </button>
          ))}
          {convs.length === 0 && (
            <p className="text-xs text-gray-600 px-3 py-2">No conversations yet</p>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-gray-500 text-lg mb-2">Start a conversation</p>
                <p className="text-gray-600 text-sm">Send a message to begin chatting with {bot.name}</p>
              </div>
            </div>
          )}
          <div className="max-w-3xl mx-auto space-y-5">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-200'
                }`}>
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {m.content}
                    {m.isStreaming && <span className="inline-block w-2 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />}
                  </div>
                  {m.tool_calls && m.tool_calls.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Tool Calls</p>
                      {m.tool_calls.map((tc: unknown, j: number) => (
                        <div key={j} className="text-xs text-gray-400 font-mono bg-gray-900 rounded px-2 py-1 mt-1">
                          {typeof tc === 'object' && tc !== null ? JSON.stringify(tc) : String(tc)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEnd} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-gray-800 p-4">
          <div className="max-w-3xl mx-auto flex gap-3">
            <textarea
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white resize-none focus:outline-none focus:border-indigo-500"
              rows={1}
              placeholder={`Message ${bot.name}... (Enter to send, Shift+Enter for newline)`}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
            />
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 rounded-xl text-sm font-medium transition-colors shrink-0"
            >
              {streaming ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

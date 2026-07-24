import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { botsApi, conversationsApi, chatStream } from '../api/client'
import type { Bot, Conversation, Message, WorkspaceTreeItem } from '../types'
import DirectoryTree from '../components/DirectoryTree'

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

  const [treeData, setTreeData] = useState<WorkspaceTreeItem[] | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [treePanelOpen, setTreePanelOpen] = useState(false)

  const [expandEditor, setExpandEditor] = useState(false)
  const [expandText, setExpandText] = useState('')
  const [editingMsgIdx, setEditingMsgIdx] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const expandTextareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })

  // Load bot info and conversations
  useEffect(() => {
    if (!botIdNum) return
    botsApi.get(botIdNum).then(setBot).catch(() => nav('/bots'))
    conversationsApi.list(botIdNum).then(setConvs)
  }, [botIdNum])

  // Scroll on new messages
  useEffect(() => { scrollToBottom() }, [messages])

  // Load workspace tree when bot changes
  useEffect(() => {
    if (!bot) return
    setTreeLoading(true)
    setTreeError(null)
    botsApi.workspace(bot.id)
      .then(setTreeData)
      .catch(e => setTreeError(e.message))
      .finally(() => setTreeLoading(false))
  }, [bot])

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

  const deleteConv = async (convId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('确定删除此对话？')) return
    await conversationsApi.delete(convId)
    setConvs(prev => prev.filter(c => c.id !== convId))
    if (activeConv?.id === convId) {
      setActiveConv(null)
      setMessages([])
    }
  }

  const doSend = async (text: string) => {
    if (!bot) return

    const userMsg: DisplayMessage = { role: 'user', content: text }
    const assistantMsg: DisplayMessage = { role: 'assistant', content: '', isStreaming: true }
    setMessages(prev => [...prev, userMsg, assistantMsg])
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
        conversationsApi.list(bot.id).then(setConvs)
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

  const send = async () => {
    if (!input.trim() || streaming || !bot) return
    const text = input.trim()
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    doSend(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 240) + 'px'
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    autoResize(e.target)
  }

  const openExpandEditor = (initialText = '') => {
    setExpandText(initialText || input)
    setExpandEditor(true)
    setTimeout(() => expandTextareaRef.current?.focus(), 50)
  }

  const closeExpandEditor = () => {
    setExpandEditor(false)
    setExpandText('')
  }

  const sendFromExpand = () => {
    if (!expandText.trim() || streaming || !bot) return
    setInput('')
    closeExpandEditor()
    doSend(expandText.trim())
  }

  const handleExpandKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      sendFromExpand()
    }
  }

  const editMessage = (idx: number, content: string) => {
    setEditingMsgIdx(idx)
    openExpandEditor(content)
  }

  const sendEdit = () => {
    if (!expandText.trim() || streaming || !bot || editingMsgIdx === null) return
    const idx = editingMsgIdx
    setInput('')
    closeExpandEditor()
    setEditingMsgIdx(null)
    // Remove messages from the edited one onward, then resend
    setMessages(prev => prev.slice(0, idx))
    doSend(expandText.trim())
  }

  const cancelEdit = () => {
    closeExpandEditor()
    setEditingMsgIdx(null)
  }

  if (!bot) {
    return (
      <div className="p-8">
        <p className="text-gray-400">加载中...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Conversation sidebar */}
      <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-800">
          <button onClick={newConv} className="w-full text-left px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-400 text-sm font-medium hover:bg-indigo-600/30 transition-colors">
            + 新建对话
          </button>
        </div>
        <div className="p-2 border-b border-gray-800">
          <button onClick={() => nav('/bots')} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 transition-colors">&larr; 返回机器人列表</button>
          <p className="text-xs text-gray-400 px-2 mt-1 truncate">{bot.name}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {convs.map(c => (
            <div
              key={c.id}
              onClick={() => selectConv(c)}
              className={`group flex items-center gap-1 px-3 py-2 rounded-lg text-sm truncate cursor-pointer transition-colors ${
                activeConv?.id === c.id
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`}
            >
              <span className="flex-1 truncate">{c.title}</span>
              <button
                onClick={e => deleteConv(c.id, e)}
                className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0 text-xs px-1"
                title="删除对话"
              >
                &times;
              </button>
            </div>
          ))}
          {convs.length === 0 && (
            <p className="text-xs text-gray-600 px-3 py-2">暂无对话记录</p>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex-1 flex flex-col relative">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-sm">
                {bot.avatar_url ? (
                  <img src={bot.avatar_url} alt={bot.name} className="w-20 h-20 rounded-full object-cover bg-gray-800 mx-auto mb-4" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-3xl font-bold mx-auto mb-4">
                    {bot.name.charAt(0)}
                  </div>
                )}
                <p className="text-white text-lg font-semibold mb-1">{bot.name}</p>
                {bot.bio && <p className="text-gray-400 text-sm mb-4">{bot.bio}</p>}
                {bot.greeting_message && (
                  <div className="bg-gray-800/50 border-l-2 border-indigo-500 rounded-r-lg px-4 py-3 text-left">
                    <p className="text-gray-300 text-sm whitespace-pre-wrap">{bot.greeting_message}</p>
                  </div>
                )}
                {!bot.greeting_message && (
                  <p className="text-gray-600 text-sm">发送消息开始与 {bot.name} 聊天</p>
                )}
              </div>
            </div>
          )}
          <div className="max-w-3xl mx-auto space-y-5">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  bot.avatar_url ? (
                    <img src={bot.avatar_url} alt={bot.name} className="w-7 h-7 rounded-full object-cover bg-gray-700 shrink-0 mt-1" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0 mt-1">
                      {bot.name.charAt(0)}
                    </div>
                  )
                )}
                <div className={`max-w-[80%] rounded-xl px-4 py-3 group relative ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-200'
                }`}>
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {m.content}
                    {m.isStreaming && <span className="inline-block w-2 h-4 bg-indigo-400 ml-0.5 animate-pulse align-middle" />}
                  </div>
                  {m.role === 'user' && !streaming && (
                    <button
                      onClick={() => editMessage(i, m.content)}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow"
                      title="编辑消息"
                    >
                      ✎
                    </button>
                  )}
                  {m.tool_calls && m.tool_calls.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">工具调用</p>
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
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <div className="flex-1 flex gap-2 items-end bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-indigo-500 transition-colors">
              <textarea
                ref={textareaRef}
                className="flex-1 bg-transparent text-sm text-white resize-none focus:outline-none placeholder-gray-500 py-1"
                rows={1}
                placeholder={`向 ${bot.name} 发送消息... (Enter 发送, Shift+Enter 换行)`}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={streaming}
              />
              <button
                onClick={() => openExpandEditor()}
                disabled={streaming}
                className="text-gray-500 hover:text-gray-300 disabled:opacity-30 text-sm px-1 transition-colors shrink-0"
                title="放大编辑 (Ctrl+Enter 发送)"
              >
                &#x26F6;
              </button>
            </div>
            <button
              onClick={send}
              disabled={streaming || !input.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 rounded-xl text-sm font-medium transition-colors shrink-0 h-10"
            >
              {streaming ? '...' : '发送'}
            </button>
          </div>
        </div>

        {/* Expand editor modal */}
        {expandEditor && (
          <div className="absolute inset-0 z-50 flex items-end justify-center pb-4 bg-black/60" onClick={cancelEdit}>
            <div
              className="w-full max-w-3xl mx-4 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
                <span className="text-xs text-gray-400">
                  {editingMsgIdx !== null ? '编辑消息' : '放大编辑'} — Ctrl+Enter 发送
                </span>
                <button
                  onClick={editingMsgIdx !== null ? cancelEdit : closeExpandEditor}
                  className="text-gray-500 hover:text-gray-300 text-sm px-1 transition-colors"
                >
                  ✕
                </button>
              </div>
              <textarea
                ref={expandTextareaRef}
                className="w-full bg-transparent text-sm text-white resize-none focus:outline-none px-4 py-3 placeholder-gray-500 min-h-[120px] max-h-[60vh]"
                rows={6}
                placeholder={`向 ${bot.name} 发送消息...`}
                value={expandText}
                onChange={e => setExpandText(e.target.value)}
                onKeyDown={handleExpandKeyDown}
                disabled={streaming}
              />
              <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-800">
                {editingMsgIdx !== null ? (
                  <>
                    <button
                      onClick={cancelEdit}
                      className="text-gray-400 hover:text-gray-200 text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={sendEdit}
                      disabled={streaming || !expandText.trim()}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors"
                    >
                      {streaming ? '...' : '发送并重新生成'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={sendFromExpand}
                    disabled={streaming || !expandText.trim()}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors"
                  >
                    {streaming ? '...' : '发送'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Workspace file tree panel */}
      {treePanelOpen ? (
        <aside className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <span className="text-xs text-gray-400 uppercase tracking-wider">工作目录</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  if (!bot) return
                  setTreeLoading(true)
                  setTreeError(null)
                  botsApi.workspace(bot.id)
                    .then(setTreeData)
                    .catch(e => setTreeError(e.message))
                    .finally(() => setTreeLoading(false))
                }}
                className="text-gray-500 hover:text-gray-300 text-xs px-1 transition-colors"
                title="刷新"
              >
                ↻
              </button>
              <button
                onClick={() => setTreePanelOpen(false)}
                className="text-gray-500 hover:text-gray-300 text-sm px-1 transition-colors"
                title="收起面板"
              >
                ◀
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <DirectoryTree
              treeData={treeData}
              loading={treeLoading}
              error={treeError}
              emptyMessage="工作空间为空"
            />
          </div>
          {treeData && treeData.length > 0 && (
            <div className="border-t border-gray-800 px-3 py-1.5">
              <span className="text-[10px] text-gray-600">
                {treeData.length} 个项目
              </span>
            </div>
          )}
        </aside>
      ) : (
        <div className="border-l border-gray-800 flex items-center shrink-0">
          <button
            onClick={() => setTreePanelOpen(true)}
            className="text-gray-600 hover:text-gray-300 text-xs px-1.5 py-3 transition-colors"
            title="展开工作目录"
          >
            ◀
          </button>
        </div>
      )}
    </div>
  )
}

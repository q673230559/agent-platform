import type { Provider, ProviderForm, ModelsResponse, FetchModelsRequest, Bot, BotForm, Tool, Conversation, Message, ChatRequest } from '../types'

const BASE = '/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// Providers
export const providersApi = {
  list: () => request<Provider[]>('/providers'),
  get: (id: number) => request<Provider>(`/providers/${id}`),
  create: (data: ProviderForm) => request<Provider>('/providers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<ProviderForm>) => request<Provider>(`/providers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/providers/${id}`, { method: 'DELETE' }),
  models: (id: number) => request<ModelsResponse>(`/providers/${id}/models`),
  fetchModels: (data: FetchModelsRequest) => request<ModelsResponse>('/providers/models', { method: 'POST', body: JSON.stringify(data) }),
}

// Bots
export const botsApi = {
  list: () => request<Bot[]>('/bots'),
  get: (id: number) => request<Bot>(`/bots/${id}`),
  create: (data: BotForm) => request<Bot>('/bots', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<BotForm>) => request<Bot>(`/bots/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/bots/${id}`, { method: 'DELETE' }),
  updateTools: (botId: number, tool_ids: number[]) => request<void>(`/bots/${botId}/tools`, { method: 'PUT', body: JSON.stringify({ tool_ids }) }),
}

// Tools
export const toolsApi = {
  list: () => request<Tool[]>('/tools'),
}

// Conversations
export const conversationsApi = {
  list: (botId?: number) => request<Conversation[]>(`/conversations${botId ? `?bot_id=${botId}` : ''}`),
  create: (bot_id: number) => request<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ bot_id }) }),
  delete: (id: number) => request<void>(`/conversations/${id}`, { method: 'DELETE' }),
  messages: (id: number) => request<Message[]>(`/conversations/${id}/messages`),
}

// Chat (SSE)
export function chatStream(
  botId: number,
  req: ChatRequest,
  onToken: (token: string) => void,
  onToolCall: (data: unknown) => void,
  onDone: (full: string, toolCalls?: unknown[]) => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController()
  fetch(`${BASE}/chat/${botId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      onError(err.detail || res.statusText)
      return
    }
    const reader = res.body?.getReader()
    if (!reader) return
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6))
            switch (evt.type) {
              case 'token': onToken(evt.content); break
              case 'tool_call': onToolCall(evt.content); break
              case 'done': onDone(evt.content, evt.tool_calls); break
              case 'error': onError(evt.content); break
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') onError(err.message)
  })
  return controller
}

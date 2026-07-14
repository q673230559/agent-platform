import type { Provider, ProviderForm, ModelsResponse, FetchModelsRequest, Bot, BotForm, Tool, Conversation, Message, ChatRequest, Orchestration, OrchestrationForm, OrchestrationRun, MultiAgentSSEEvent, WorkspaceTreeItem } from '../types'

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

// Orchestrations
export const orchestrationsApi = {
  list: () => request<Orchestration[]>('/orchestrations'),
  get: (id: number) => request<Orchestration>(`/orchestrations/${id}`),
  create: (data: OrchestrationForm) =>
    request<Orchestration>('/orchestrations', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<OrchestrationForm>) =>
    request<Orchestration>(`/orchestrations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<void>(`/orchestrations/${id}`, { method: 'DELETE' }),
  runs: (id: number) => request<OrchestrationRun[]>(`/orchestrations/${id}/runs`),
  runDetail: (runId: number) => request<OrchestrationRun>(`/orchestrations/runs/${runId}`),
  deleteRun: (runId: number) => request<void>(`/orchestrations/runs/${runId}`, { method: 'DELETE' }),
  workspace: (id: number) => request<WorkspaceTreeItem[]>(`/orchestrations/${id}/workspace`),
  testScript: (id: number, data: { script: string; requirements: string }) =>
    request<{ stdout: string; stderr: string; exit_code: number }>(`/orchestrations/${id}/test-script`, { method: 'POST', body: JSON.stringify(data) }),
}

export function orchestrationStream(
  orchestrationId: number,
  message: string,
  callbacks: {
    onStart: (nodes: { id: number; label: string; node_type: string }[]) => void
    onNodeStart: (nodeId: number, label: string) => void
    onToken: (nodeId: number, label: string, token: string) => void
    onToolCall: (nodeId: number, label: string, data: unknown) => void
    onNodeEnd: (nodeId: number, label: string, output: string) => void
    onNodeSkip: (nodeId: number, label: string) => void
    onNodeError: (nodeId: number, label: string, error: string) => void
    onDone: (result: Record<string, unknown>) => void
    onStopped: () => void
    onError: (err: string) => void
  },
): AbortController {
  const controller = new AbortController()
  fetch(`${BASE}/orchestrations/${orchestrationId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      callbacks.onError(err.detail || res.statusText)
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
            const evt: MultiAgentSSEEvent = JSON.parse(line.slice(6))
            switch (evt.type) {
              case 'orchestration_start':
                callbacks.onStart(evt.nodes || [])
                break
              case 'node_start':
                callbacks.onNodeStart(evt.node_id!, evt.node_label!)
                break
              case 'token':
                callbacks.onToken(evt.node_id!, evt.node_label!, evt.content!)
                break
              case 'tool_call':
                callbacks.onToolCall(evt.node_id!, evt.node_label!, evt.content!)
                break
              case 'node_end':
                callbacks.onNodeEnd(evt.node_id!, evt.node_label!, evt.output || '')
                break
              case 'node_skip':
                callbacks.onNodeSkip(evt.node_id!, evt.node_label!)
                break
              case 'node_error':
                callbacks.onNodeError(evt.node_id!, evt.node_label!, evt.content || '')
                break
              case 'orchestration_done':
                if (evt.failed) {
                  callbacks.onError('编排执行失败：节点执行出错')
                } else {
                  callbacks.onDone(evt.result || {})
                }
                break
              case 'error':
                callbacks.onError(evt.content!)
                break
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }
  }).catch((err) => {
    if (err.name === 'AbortError') {
      callbacks.onStopped()
    } else {
      callbacks.onError(err.message)
    }
  })
  return controller
}

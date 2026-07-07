export interface Provider {
  id: number
  name: string
  base_url: string
  api_key: string
  default_model: string
  created_at: string
  updated_at: string | null
}

export interface ProviderForm {
  name: string
  base_url: string
  api_key: string
  default_model: string
}

export interface Tool {
  id: number
  name: string
  display_name: string
  description: string
}

export interface Bot {
  id: number
  name: string
  provider_id: number
  model_name: string
  system_prompt: string
  temperature: number
  is_active: boolean
  tools: Tool[]
  avatar_url: string
  bio: string
  greeting_message: string
  tags: string[]
  created_at: string
  updated_at: string | null
}

export interface BotForm {
  name: string
  provider_id: number
  model_name: string
  system_prompt: string
  temperature: number
  is_active: boolean
  tool_ids: number[]
  avatar_url: string
  bio: string
  greeting_message: string
  tags: string[]
}

export interface Conversation {
  id: number
  bot_id: number
  title: string
  created_at: string
}

export interface Message {
  id: number
  conversation_id: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls: unknown[] | null
  created_at: string
}

export interface ChatRequest {
  conversation_id?: number
  message: string
}

export interface ModelsResponse {
  models: string[]
}

export interface FetchModelsRequest {
  base_url: string
  api_key: string
}

export interface SSEEvent {
  type: 'token' | 'tool_call' | 'done' | 'error'
  content: string
  tool_calls?: unknown[]
}

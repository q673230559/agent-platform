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
  category: string
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

export interface DashboardStats {
  providers: number
  bots: number
  orchestrations: number
  orchestration_runs: number
}

// ── Orchestration ──

export type OrchestrationType = 'supervisor' | 'dag' | 'swarm'

export interface OrchestrationNodeData {
  id: number
  node_type: string
  node_key: string
  label: string
  position_x: number
  position_y: number
  config: Record<string, unknown>
}

export interface OrchestrationEdgeData {
  id: number
  source_node_id: number
  target_node_id: number
  condition: string
  label: string
  is_default: boolean
}

export interface Orchestration {
  id: number
  name: string
  description: string
  orchestration_type: OrchestrationType
  config: Record<string, unknown>
  is_active: boolean
  cron_expression: string | null
  schedule_enabled: boolean
  max_retries: number
  recursion_limit: number
  next_run_at: string | null
  nodes: OrchestrationNodeData[]
  edges: OrchestrationEdgeData[]
  created_at: string
  updated_at: string | null
}

export interface NodeForm {
  node_type: string
  node_key: string
  label: string
  position_x: number
  position_y: number
  config: Record<string, unknown>
  temp_id: string
}

export interface EdgeForm {
  source_node_id: number
  target_node_id: number
  condition: string
  label: string
  is_default: boolean
}

export interface OrchestrationForm {
  name: string
  description: string
  orchestration_type: OrchestrationType
  config: Record<string, unknown>
  is_active: boolean
  cron_expression: string | null
  schedule_enabled: boolean
  max_retries: number
  recursion_limit: number
  nodes: NodeForm[]
  edges: EdgeForm[]
}

export interface OrchestrationRun {
  id: number
  orchestration_id: number
  input_message: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped'
  result: Record<string, unknown> | null
  events: RunEvent[]
  created_at: string
  completed_at: string | null
}

export interface RunEvent {
  id: number
  node_id: number | null
  event_type: string
  content: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface PaginatedRunList {
  items: OrchestrationRun[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface WorkspaceTreeItem {
  name: string
  path: string
  type: 'directory' | 'file'
  children: WorkspaceTreeItem[]
}

export interface MultiAgentSSEEvent {
  type: 'orchestration_start' | 'node_start' | 'token' | 'tool_call' | 'node_end' | 'node_skip' | 'node_error' | 'orchestration_done' | 'error'
  node_id?: number
  node_label?: string
  nodes?: { id: number; label: string; node_type: string; node_key?: string; config?: Record<string, unknown> }[]
  content?: string
  output?: string
  result?: Record<string, unknown>
  failed?: boolean
  metadata?: Record<string, unknown>
}

// ── Import / Export ──

export interface ImportNode {
  temp_id: string
  node_type: string
  node_key: string
  label: string
  position_x: number
  position_y: number
  config: Record<string, unknown>
}

export interface ImportEdge {
  source_temp_id: string
  target_temp_id: string
  condition: string
  label: string
  is_default: boolean
}

export interface ImportOrchestration {
  name: string
  description: string
  orchestration_type: OrchestrationType
  config: Record<string, unknown>
  is_active: boolean
  cron_expression: string | null
  schedule_enabled: boolean
  max_retries: number
  recursion_limit: number
  nodes: ImportNode[]
  edges: ImportEdge[]
}

export interface ImportPayload {
  version: number
  exported_at: string | null
  orchestration: ImportOrchestration
}

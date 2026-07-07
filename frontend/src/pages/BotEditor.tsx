import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { providersApi, botsApi, toolsApi } from '../api/client'
import type { Provider, Tool, BotForm } from '../types'

const defaultForm: BotForm = {
  name: '', provider_id: 0, model_name: '',
  system_prompt: '', temperature: 0.7, is_active: true, tool_ids: [],
}

export default function BotEditor() {
  const { id } = useParams()
  const nav = useNavigate()
  const isEdit = !!id

  const [providers, setProviders] = useState<Provider[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [form, setForm] = useState<BotForm>(defaultForm)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [customModel, setCustomModel] = useState(false)

  useEffect(() => {
    providersApi.list().then(setProviders)
    toolsApi.list().then(setTools)
    if (isEdit) {
      botsApi.get(Number(id)).then(b => {
        setForm({
          name: b.name,
          provider_id: b.provider_id,
          model_name: b.model_name,
          system_prompt: b.system_prompt,
          temperature: b.temperature,
          is_active: b.is_active,
          tool_ids: b.tools.map(t => t.id),
        })
        fetchModels(b.provider_id)
      })
    }
  }, [id])

  const fetchModels = async (providerId: number) => {
    if (!providerId) return
    setModelsLoading(true)
    setModels([])
    try {
      const res = await providersApi.models(providerId)
      setModels(res.models)
    } catch {
      setModels([])
    } finally {
      setModelsLoading(false)
    }
  }

  const handleProviderChange = (providerId: number) => {
    setForm(f => ({ ...f, provider_id: providerId, model_name: '' }))
    fetchModels(providerId)
  }

  const toggleTool = (tid: number) => {
    setForm(f => ({
      ...f,
      tool_ids: f.tool_ids.includes(tid) ? f.tool_ids.filter(t => t !== tid) : [...f.tool_ids, tid],
    }))
  }

  const submit = async () => {
    setError('')
    setLoading(true)
    try {
      if (isEdit) {
        await botsApi.update(Number(id), form)
      } else {
        await botsApi.create(form)
      }
      nav('/bots')
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-white mb-6">{isEdit ? 'Edit Bot' : 'Create New Bot'}</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">Bot Name</label>
          <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Assistant" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Provider</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.provider_id} onChange={e => handleProviderChange(Number(e.target.value))}>
              <option value={0} disabled>Select a provider</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Model Name {modelsLoading && <span className="text-indigo-400">loading...</span>}</label>
            {models.length > 0 && !customModel ? (
              <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.model_name} onChange={e => {
                if (e.target.value === '_custom_') {
                  setCustomModel(true)
                  setForm(f => ({ ...f, model_name: '' }))
                } else {
                  setForm(f => ({ ...f, model_name: e.target.value }))
                }
              }}>
                <option value="" disabled>Select a model</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="_custom_">+ Custom model name...</option>
              </select>
            ) : null}
            {(customModel || models.length === 0) && (
              <div className="flex gap-2">
                <input className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.model_name} onChange={e => setForm(f => ({ ...f, model_name: e.target.value }))} placeholder="deepseek-v4-flash" />
                {models.length > 0 && (
                  <button onClick={() => { setCustomModel(false); setForm(f => ({ ...f, model_name: '' })) }} className="text-gray-400 hover:text-white text-xs shrink-0">back to list</button>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">System Prompt</label>
          <textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 h-24 resize-none" value={form.system_prompt} onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))} placeholder="You are a helpful assistant..." />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Temperature ({form.temperature})</label>
            <input type="range" min="0" max="2" step="0.1" className="w-full accent-indigo-500" value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" className="accent-indigo-500" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
              Active
            </label>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">Tools</label>
          <div className="flex flex-wrap gap-2">
            {tools.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTool(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  form.tool_ids.includes(t.id)
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                }`}
                title={t.description}
              >
                {t.display_name}
              </button>
            ))}
            {tools.length === 0 && <p className="text-xs text-gray-600">No tools available</p>}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={submit} disabled={loading} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {loading ? 'Saving...' : (isEdit ? 'Update Bot' : 'Create Bot')}
          </button>
          <button onClick={() => nav('/bots')} className="text-gray-400 hover:text-white text-sm">Cancel</button>
        </div>
      </div>
    </div>
  )
}

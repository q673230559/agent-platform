import { useEffect, useState } from 'react'
import { providersApi } from '../api/client'
import type { Provider, ProviderForm } from '../types'

const empty: ProviderForm = { name: '', base_url: '', api_key: '', default_model: '' }

export default function Providers() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [editing, setEditing] = useState<Provider | null>(null)
  const [form, setForm] = useState<ProviderForm>(empty)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')
  const [modelList, setModelList] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [customDefault, setCustomDefault] = useState(false)

  const load = () => providersApi.list().then(setProviders).catch(() => {})

  useEffect(() => { load() }, [])

  const fetchModels = async () => {
    if (!form.base_url || !form.api_key) return
    setModelsLoading(true)
    setError('')
    try {
      const res = await providersApi.fetchModels({ base_url: form.base_url, api_key: form.api_key })
      setModelList(res.models)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setModelsLoading(false)
    }
  }

  const submit = async () => {
    setError('')
    try {
      if (editing) {
        await providersApi.update(editing.id, form)
      } else {
        await providersApi.create(form)
      }
      setShowForm(false)
      setEditing(null)
      setForm(empty)
      setModelList([])
      setCustomDefault(false)
      load()
    } catch (e: unknown) {
      setError((e as Error).message)
    }
  }

  const remove = async (id: number) => {
    if (!confirm('确定删除此供应商？')) return
    try {
      await providersApi.delete(id)
      load()
    } catch (e: unknown) {
      alert((e as Error).message)
    }
  }

  const openEdit = (p: Provider) => {
    setEditing(p)
    setForm({ name: p.name, base_url: p.base_url, api_key: '', default_model: p.default_model })
    setModelList([])
    setCustomDefault(false)
    setShowForm(true)
  }

  const openCreate = () => {
    setEditing(null)
    setForm(empty)
    setModelList([])
    setCustomDefault(false)
    setShowForm(true)
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">模型供应商</h2>
        <button onClick={openCreate} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          添加供应商
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">{editing ? '编辑' : '新建'}供应商</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">名称</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="DeepSeek" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">接口地址</label>
              <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.base_url} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))} placeholder="https://api.deepseek.com" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">API Key</label>
              <input type="password" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))} placeholder={editing ? '（留空则不修改）' : 'sk-xxx'} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">默认模型 {modelsLoading && <span className="text-indigo-400">加载中...</span>}</label>
                <button type="button" onClick={fetchModels} disabled={modelsLoading || !form.base_url || !form.api_key} className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:text-gray-600 disabled:cursor-not-allowed">
                  {modelsLoading ? '获取中...' : '获取模型列表'}
                </button>
              </div>
              {modelList.length > 0 && !customDefault ? (
                <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.default_model} onChange={e => {
                  if (e.target.value === '_custom_') {
                    setCustomDefault(true)
                    setForm(f => ({ ...f, default_model: '' }))
                  } else {
                    setForm(f => ({ ...f, default_model: e.target.value }))
                  }
                }}>
                  <option value="" disabled>选择模型</option>
                  {modelList.map(m => <option key={m} value={m}>{m}</option>)}
                  <option value="_custom_">+ 手动输入模型名...</option>
                </select>
              ) : null}
              {(customDefault || modelList.length === 0) && (
                <div className="flex gap-2">
                  <input className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.default_model} onChange={e => setForm(f => ({ ...f, default_model: e.target.value }))} placeholder="deepseek-v4-flash" />
                  {modelList.length > 0 && (
                    <button type="button" onClick={() => { setCustomDefault(false); setForm(f => ({ ...f, default_model: '' })) }} className="text-gray-400 hover:text-white text-xs shrink-0">返回列表</button>
                  )}
                </div>
              )}
            </div>
          </div>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <div className="flex gap-3">
            <button onClick={submit} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium">{editing ? '更新' : '创建'}</button>
            <button onClick={() => { setShowForm(false); setEditing(null) }} className="text-gray-400 hover:text-white text-sm">取消</button>
          </div>
        </div>
      )}

      {providers.length === 0 && !showForm && (
        <p className="text-gray-500 text-sm">暂无供应商，请添加第一个模型供应商。</p>
      )}

      <div className="space-y-3">
        {providers.map(p => (
          <div key={p.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-white font-medium">{p.name}</p>
              <p className="text-xs text-gray-500">{p.base_url} &middot; {p.default_model}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-white text-sm px-2 py-1">编辑</button>
              <button onClick={() => remove(p.id)} className="text-red-400 hover:text-red-300 text-sm px-2 py-1">删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

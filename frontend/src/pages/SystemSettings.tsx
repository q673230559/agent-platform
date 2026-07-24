import { useEffect, useState } from 'react'
import { providersApi, systemSettingsApi } from '../api/client'
import type { Provider } from '../types'

export default function SystemSettings() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [providerId, setProviderId] = useState<number>(0)
  const [modelName, setModelName] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    providersApi.list().then(setProviders).catch(() => {})
    systemSettingsApi.get().then(s => {
      if (s.provider_id) {
        setProviderId(s.provider_id)
        setModelName(s.model_name || '')
        fetchModels(s.provider_id)
      }
    }).catch(() => {})
  }, [])

  const fetchModels = async (pid: number) => {
    if (!pid) return
    setModelsLoading(true)
    setModels([])
    try {
      const res = await providersApi.models(pid)
      setModels(res.models)
    } catch {
      setModels([])
    } finally {
      setModelsLoading(false)
    }
  }

  const handleProviderChange = (pid: number) => {
    setProviderId(pid)
    setModelName('')
    setCustomModel(false)
    if (pid) fetchModels(pid)
  }

  const save = async () => {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      await systemSettingsApi.update({
        provider_id: providerId || null,
        model_name: modelName || null,
      })
      setSuccess('系统设置已保存')
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-white mb-6">系统设置</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
        <p className="text-sm text-gray-400">
          配置系统模型后，平台可以调用该模型完成内置的智能功能，例如自动生成机器人名称、简介、对话摘要等。
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">供应商</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={providerId}
              onChange={e => handleProviderChange(Number(e.target.value))}
            >
              <option value={0}>不选择（禁用系统模型）</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">
              模型名称 {modelsLoading && <span className="text-indigo-400">加载中...</span>}
            </label>
            {models.length > 0 && !customModel ? (
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                value={modelName}
                onChange={e => {
                  if (e.target.value === '_custom_') {
                    setCustomModel(true)
                    setModelName('')
                  } else {
                    setModelName(e.target.value)
                  }
                }}
              >
                <option value="" disabled>选择模型</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="_custom_">+ 手动输入模型名...</option>
              </select>
            ) : null}
            {(customModel || models.length === 0) && (
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={modelName}
                  onChange={e => setModelName(e.target.value)}
                  placeholder="deepseek-v4-flash"
                  disabled={!providerId}
                />
                {models.length > 0 && (
                  <button
                    onClick={() => { setCustomModel(false); setModelName('') }}
                    className="text-gray-400 hover:text-white text-xs shrink-0"
                  >
                    返回列表
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && <p className="text-emerald-400 text-sm">{success}</p>}

        <button
          onClick={save}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { providersApi, botsApi, toolsApi } from '../api/client'
import type { Provider, Tool, BotForm } from '../types'

const defaultForm: BotForm = {
  name: '', provider_id: 0, model_name: '',
  system_prompt: '', temperature: 0.7, is_active: true, tool_ids: [],
  avatar_url: '', bio: '', greeting_message: '', tags: [],
}

const avatarColors = ['6366f1', '8b5cf6', 'a855f7', '7c3aed', '4f46e5', '0ea5e9', '06b6d4', '10b981', 'f59e0b', 'ef4444', 'ec4899', 'e11d48']

function genAvatarUrl(name: string) {
  if (!name) return ''
  const bg = avatarColors[Math.floor(Math.random() * avatarColors.length)]
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&size=128&background=${bg}&color=fff`
}

const templates = [
  {
    name: 'HR 小助手',
    avatar_url: '',
    bio: '专业的人力资源助手，解答薪酬福利、考勤假期、入职培训等问题',
    greeting_message: '你好！我是 HR 小助手 👋\n\n我可以帮你解答薪酬福利、考勤假期、入职流程、培训安排等问题。有什么需要帮忙的吗？',
    system_prompt: '你是一位专业的人力资源助手，熟悉劳动法、薪酬体系和员工福利。回答问题时保持专业、耐心、友善。',
    tags: ['HR', '办公', '员工服务'],
  },
  {
    name: '代码审查员',
    avatar_url: '',
    bio: '资深代码审查专家，提供代码优化建议和最佳实践指导',
    greeting_message: 'Hello! 我是代码审查员 🔍\n\n我可以帮你审查代码质量、提供优化建议、解释技术方案。把你的代码发给我吧！',
    system_prompt: '你是一位资深软件工程师和代码审查专家，精通多种编程语言和设计模式。提供简洁、可操作的代码改进建议。',
    tags: ['开发', '技术', '代码'],
  },
  {
    name: '翻译官',
    avatar_url: '',
    bio: '精通中英日韩等多语种翻译，支持商务、技术、文学等场景',
    greeting_message: '你好！我是翻译官 🌐\n\n我可以帮你进行多语种翻译，支持中文、英文、日文、韩文等。直接发文字给我即可。',
    system_prompt: '你是一位专业翻译官，精通中文、英文、日文、韩文。翻译准确、地道，能根据语境选择合适的表达方式。',
    tags: ['翻译', '语言', '国际化'],
  },
  {
    name: '客服小美',
    avatar_url: '',
    bio: '7x24 小时在线客服，快速响应用户咨询与问题处理',
    greeting_message: '您好！我是客服小美 😊\n\n很高兴为您服务！无论您遇到什么问题，都可以随时告诉我，我会尽快帮您解决。',
    system_prompt: '你是一位专业、热情、耐心的客服专员。始终以客户满意度为第一目标，快速理解问题并给出清晰明确的解决方案。',
    tags: ['客服', '服务', '咨询'],
  },
  {
    name: '文案大师',
    avatar_url: '',
    bio: '创意文案写手，擅长品牌文案、新媒体内容、广告创意',
    greeting_message: '嗨！我是文案大师 ✍️\n\n我可以帮你写公众号推文、品牌介绍、广告文案、小红书笔记……告诉我你的需求，马上开写！',
    system_prompt: '你是一位资深文案撰稿人，擅长各种文体和风格的文案创作。文字有感染力，能抓住读者注意力。',
    tags: ['文案', '创作', '营销'],
  },
  {
    name: '数据分析师',
    avatar_url: '',
    bio: '数据分析与商业智能专家，从数据中洞察业务增长机会',
    greeting_message: '你好！我是数据分析师 📊\n\n我可以帮你分析数据趋势、制作报表解读、提供业务洞察。请描述你的分析需求。',
    system_prompt: '你是一位资深数据分析师，精通统计学、数据可视化和商业分析。从数据中提炼关键洞察，给出可落地的建议。',
    tags: ['数据', '分析', '商业智能'],
  },
]

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
  const [tagInput, setTagInput] = useState('')

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
          avatar_url: b.avatar_url || '',
          bio: b.bio || '',
          greeting_message: b.greeting_message || '',
          tags: b.tags || [],
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

  const addTag = () => {
    const tag = tagInput.trim()
    if (tag && !form.tags.includes(tag)) {
      setForm(f => ({ ...f, tags: [...f.tags, tag] }))
    }
    setTagInput('')
  }

  const removeTag = (tag: string) => {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
  }

  const randomFill = () => {
    const t = templates[Math.floor(Math.random() * templates.length)]
    setForm(f => ({
      ...f,
      name: t.name,
      avatar_url: genAvatarUrl(t.name),
      bio: t.bio,
      greeting_message: t.greeting_message,
      system_prompt: t.system_prompt,
      tags: [...t.tags],
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
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{isEdit ? '编辑机器人' : '创建机器人'}</h2>
        {!isEdit && (
          <button onClick={randomFill} className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 rounded-lg px-3 py-1.5 hover:bg-indigo-500/10 transition-colors">
            🎲 随机生成
          </button>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
        {/* Name + Avatar */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">机器人名称</label>
            <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="我的数字人" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">头像</label>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <div className="flex gap-1 mb-1.5">
                  <input className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.avatar_url} onChange={e => setForm(f => ({ ...f, avatar_url: e.target.value }))} placeholder="https://..." />
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, avatar_url: genAvatarUrl(f.name) }))}
                    disabled={!form.name}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 rounded-lg px-2 py-2 hover:bg-indigo-500/10 disabled:opacity-30 disabled:cursor-not-allowed shrink-0 transition-colors"
                    title="根据名称生成头像"
                  >
                    生成
                  </button>
                </div>
                <p className="text-[10px] text-gray-600">输入 URL 或点击"生成"根据名称自动创建</p>
              </div>
              {form.avatar_url && (
                <img src={form.avatar_url} alt="头像预览" className="w-12 h-12 rounded-full object-cover bg-gray-800 shrink-0 border border-gray-700" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}
            </div>
          </div>
        </div>

        {/* Bio */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            简介 <span className="text-gray-600">{form.bio.length}/300</span>
          </label>
          <input className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} placeholder="简要描述机器人的功能与定位" maxLength={300} />
        </div>

        {/* Provider + Model */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">供应商</label>
            <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.provider_id} onChange={e => handleProviderChange(Number(e.target.value))}>
              <option value={0} disabled>选择供应商</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">模型名称 {modelsLoading && <span className="text-indigo-400">加载中...</span>}</label>
            {models.length > 0 && !customModel ? (
              <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.model_name} onChange={e => {
                if (e.target.value === '_custom_') {
                  setCustomModel(true)
                  setForm(f => ({ ...f, model_name: '' }))
                } else {
                  setForm(f => ({ ...f, model_name: e.target.value }))
                }
              }}>
                <option value="" disabled>选择模型</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
                <option value="_custom_">+ 手动输入模型名...</option>
              </select>
            ) : null}
            {(customModel || models.length === 0) && (
              <div className="flex gap-2">
                <input className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500" value={form.model_name} onChange={e => setForm(f => ({ ...f, model_name: e.target.value }))} placeholder="deepseek-v4-flash" />
                {models.length > 0 && (
                  <button onClick={() => { setCustomModel(false); setForm(f => ({ ...f, model_name: '' })) }} className="text-gray-400 hover:text-white text-xs shrink-0">返回列表</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Greeting Message */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">欢迎语</label>
          <textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 h-20 resize-none" value={form.greeting_message} onChange={e => setForm(f => ({ ...f, greeting_message: e.target.value }))} placeholder="用户初次进入对话时看到的欢迎消息" />
        </div>

        {/* System Prompt */}
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">系统提示词</label>
          <textarea className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 h-24 resize-none" value={form.system_prompt} onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))} placeholder="你是一个有用的助手..." />
        </div>

        {/* Temperature + Active */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">温度 ({form.temperature})</label>
            <input type="range" min="0" max="2" step="0.1" className="w-full accent-indigo-500" value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" className="accent-indigo-500" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
              启用
            </label>
          </div>
        </div>

        {/* Tools */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">工具</label>
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
            {tools.length === 0 && <p className="text-xs text-gray-600">暂无可用工具</p>}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">标签</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {form.tags.map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
                {tag}
                <button onClick={() => removeTag(tag)} className="text-indigo-400 hover:text-red-400 transition-colors">&times;</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="输入标签后按 Enter 添加"
            />
            <button onClick={addTag} className="text-xs text-gray-400 hover:text-white border border-gray-700 rounded-lg px-3 py-2 hover:bg-gray-800 transition-colors">添加</button>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={submit} disabled={loading} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {loading ? '保存中...' : (isEdit ? '更新机器人' : '创建机器人')}
          </button>
          <button onClick={() => nav('/bots')} className="text-gray-400 hover:text-white text-sm">取消</button>
        </div>
      </div>
    </div>
  )
}

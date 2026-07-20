import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Providers from './pages/Providers'
import Bots from './pages/Bots'
import BotEditor from './pages/BotEditor'
import Chat from './pages/Chat'
import Orchestrations from './pages/Orchestrations'
import OrchestrationEditor from './pages/OrchestrationEditor'
import OrchestrationRun from './pages/OrchestrationRun'
import RunHistory from './pages/RunHistory'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/providers" element={<Providers />} />
        <Route path="/bots" element={<Bots />} />
        <Route path="/bots/new" element={<BotEditor />} />
        <Route path="/bots/:id/edit" element={<BotEditor />} />
        <Route path="/chat/:botId" element={<Chat />} />
        <Route path="/orchestrations" element={<Orchestrations />} />
        <Route path="/orchestrations/new" element={<OrchestrationEditor />} />
        <Route path="/orchestrations/:id/edit" element={<OrchestrationEditor />} />
        <Route path="/orchestrations/:id/run" element={<OrchestrationRun />} />
        <Route path="/orchestrations/:id/runs" element={<RunHistory />} />
      </Routes>
    </Layout>
  )
}

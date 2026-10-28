import { Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { homeworkSessionStarted } from './lib/session'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import MathPage from './pages/MathPage'
import ChinesePage from './pages/ChinesePage'
import CodingPage from './pages/CodingPage'
import WrongBookPage from './pages/WrongBookPage'
import GraphPage from './pages/GraphPage'
import ReportPage from './pages/ReportPage'
import ParentPage from './pages/ParentPage'
import LearnCenterPage from './pages/LearnCenterPage'

const EnglishPage = lazy(() => import('./pages/RazEnglishPage'))
function EnglishRoute({ testMode = false }: { testMode?: boolean }) {
  return <Suspense fallback={<p className="py-8">正在加载英语阅读…</p>}><EnglishPage testMode={testMode} /></Suspense>
}

function HomeworkSession() {
  const { date = '' } = useParams()
  return homeworkSessionStarted(date) ? <Outlet /> : <Navigate to="/" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/watch" element={<Navigate to="/parent" replace />} />

      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route element={<HomeworkSession />}>
          <Route path="/math/:date" element={<MathPage />} />
          <Route path="/chinese/:date" element={<ChinesePage />} />
          <Route path="/english/:date" element={<EnglishRoute />} />
          <Route path="/coding/:date" element={<CodingPage />} />
        </Route>
        <Route path="/wrong" element={<WrongBookPage />} />
        <Route path="/learn" element={<LearnCenterPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/parent" element={<ParentPage />} />
        <Route path="/parent/english-test/:date" element={<EnglishRoute testMode />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

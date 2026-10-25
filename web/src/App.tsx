import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import MathPage from './pages/MathPage'
import ChinesePage from './pages/ChinesePage'
import EnglishPage from './pages/EnglishPage'
import CodingPage from './pages/CodingPage'
import WrongBookPage from './pages/WrongBookPage'
import GraphPage from './pages/GraphPage'
import ReportPage from './pages/ReportPage'
import ParentPage from './pages/ParentPage'
import WatchPage from './pages/WatchPage'
import LearnCenterPage from './pages/LearnCenterPage'

export default function App() {
  return (
    <Routes>
      {/* 观看页独立出来，方便爸爸手机直接打开 */}
      <Route path="/watch" element={<WatchPage />} />

      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/math/:date" element={<MathPage />} />
        <Route path="/chinese/:date" element={<ChinesePage />} />
        <Route path="/english/:date" element={<EnglishPage />} />
        <Route path="/coding/:date" element={<CodingPage />} />
        <Route path="/wrong" element={<WrongBookPage />} />
        <Route path="/learn" element={<LearnCenterPage />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/parent" element={<ParentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

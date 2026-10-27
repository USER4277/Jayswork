import { createContext, useContext } from 'react'

export interface MonitoringState {
  /** AI 是否已配置 */
  aiOn: boolean | null
  monitoring: boolean
  deadline: string
  speechScoring: boolean
}

export const MonitoringContext = createContext<MonitoringState>({ aiOn: null, monitoring: false, deadline: '', speechScoring: false })

export const useMonitoring = () => useContext(MonitoringContext)

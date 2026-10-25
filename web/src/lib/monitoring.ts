import { createContext, useContext } from 'react'

export interface MonitoringState {
  /** AI 是否已配置 */
  aiOn: boolean | null
}

export const MonitoringContext = createContext<MonitoringState>({ aiOn: null })

export const useMonitoring = () => useContext(MonitoringContext)

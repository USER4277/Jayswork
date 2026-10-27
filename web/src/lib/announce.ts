import { speak } from './speech'

export const START_ANNOUNCEMENT = '现在开始做作业，将打开摄像头并在本机录像，请认真完成作业。'
export const COMPLETED_ANNOUNCEMENT = '今日作业已全部完成，请立即离开。'

export function announceStart(onEnd?: () => void) {
  speak(START_ANNOUNCEMENT, { lang: 'zh-CN', rate: 0.85, onEnd })
}

export function announceCompleted() {
  speak(COMPLETED_ANNOUNCEMENT, { lang: 'zh-CN', rate: 0.85 })
}

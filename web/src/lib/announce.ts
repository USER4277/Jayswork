import { speak } from './speech'

/**
 * 开始做作业时的语音播报。
 *
 * 这段话是需求里指定的原文，让孩子既听见、也看见「监控已经打开」这件事，
 * 不搞偷偷摸摸。
 */
export const START_ANNOUNCEMENT = '现在开始做作业，实时监控已打开，请认真完成作业，画面实时同步到爸爸手机。'

export function announceStart(onEnd?: () => void) {
  speak(START_ANNOUNCEMENT, { lang: 'zh-CN', rate: 0.85, onEnd })
}

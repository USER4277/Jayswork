/**
 * 「开始今日作业」这个动作的广播。
 *
 * 首页按钮点下去之后，页面各处（摄像头浮层）都要知道：
 * 用一个很小的发布订阅就够用了，不值得引状态管理库。
 */

type StartHandler = (date: string) => void

const handlers = new Set<StartHandler>()

export function onStartSession(fn: StartHandler) {
  handlers.add(fn)
  return () => {
    handlers.delete(fn)
  }
}

export function emitStartSession(date: string) {
  handlers.forEach((fn) => fn(date))
}

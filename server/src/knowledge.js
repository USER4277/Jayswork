/**
 * 作业题型 → 知识点（cn-math-taxonomy 的 id）的映射。
 *
 * 错题入库时用它自动打知识点标签，这样错题本才能按知识点聚合。
 * 映射表是按小学二年级学生能碰到的知识点挑的。
 */

export const MATH_GROUP_POINTS = {
  arith: ['cnm_p057', 'cnm_p223'],
  addsub: ['cnm_p071', 'cnm_p072'],
  remainder: ['cnm_p050', 'cnm_p051', 'cnm_p052'],
  word: ['cnm_p048', 'cnm_p218', 'cnm_p060'],
  extend: ['cnm_p024', 'cnm_p060'],
}

/** 拓展题按 (天, 题号) 精确指定知识点 */
export const EXTEND_POINTS = {
  '1-9': ['cnm_p024'],
  '1-10': ['cnm_p060'],
  '2-9': ['cnm_p060'],
  '2-10': ['cnm_p057'],
  '3-9': ['cnm_p024'],
  '3-10': ['cnm_p060'],
  '4-9': ['cnm_p060'],
  '4-10': ['cnm_p060'],
  '5-9': ['cnm_p024'],
  '5-10': ['cnm_p060'],
  '6-9': ['cnm_p024'],
  '6-10': ['cnm_p060'],
  '7-9': ['cnm_p131'],
  '7-10': ['cnm_p153'],
  '8-9': ['cnm_p057'],
  '8-10': ['cnm_p060'],
  '9-9': ['cnm_p024'],
  '9-10': ['cnm_p024'],
  '10-9': ['cnm_p024'],
  '10-10': ['cnm_p129'],
  '11-9': ['cnm_p057'],
  '11-10': ['cnm_p060'],
  '12-9': ['cnm_p024'],
  '12-10': ['cnm_p024'],
  '13-9': ['cnm_p057'],
  '13-10': ['cnm_p153'],
  '14-9': ['cnm_p060'],
  '14-10': ['cnm_p060'],
}

/** 语文题目 → 知识点（按题目关键词匹配） */
export const CHINESE_KEYWORDS = [
  { keys: ['疑', '鸣', '倍', '把酒', '雨疏', '卷帘', '性', '习', '说', '缕', '蒙', '盼', '轻轻', '才', '碧玉', '日当午'], points: ['cnc_p001'] },
  { keys: ['景物', '顺序', '写了哪几种', '四幅小画'], points: ['cnc_p002'] },
]

export function pointsForMath(groupKey, day, no) {
  if (groupKey === 'extend') {
    const exact = EXTEND_POINTS[`${day}-${no}`]
    if (exact?.length) return exact
  }
  return MATH_GROUP_POINTS[groupKey] || []
}

export function pointsForChinese(prompt) {
  const hit = CHINESE_KEYWORDS.find((k) => k.keys.some((word) => prompt.includes(word)))
  return hit?.points || []
}

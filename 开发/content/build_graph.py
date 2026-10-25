#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从隔壁的 cn-math-taxonomy 仓库抽取「小学」知识点子集，供本系统的学习中心使用。

源数据（全部是裸 JSON 数组，没有 wrapper）：
  data/topics.json         2202 条知识点。小学数学 = id 以 cnm_p 开头（242 条）
  data/dependencies.json   3429 条先修边 {topicId, prerequisiteId, strength, reason}
  data/questions.json      8955 道题。小学数学 968 道（每个 topic 恰好 4 道）
  data/cn-curriculum-standards.json  课标条目

方向约定：prerequisiteId → topicId（先修 → 后学，箭头指向 dependent）。
subject 要靠 id 前缀推断（数学 topic 没有 subject 字段）。

用法：
    python3 开发/content/build_graph.py
    python3 开发/content/build_graph.py --src <cn-math-taxonomy 路径>
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SRC = ROOT.parent / "cn-math-taxonomy"

SUBJECTS = {
    "math": "cnm_p",
    "english": "cne_p",
    "chinese": "cnc_p",
}
# 数学只有初中/高中两个 stage 字母；小学统一用 p
PRIMARY_PREFIX = {"math": "cnm_p", "english": "cne_p", "chinese": "cnc_p"}


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(DEFAULT_SRC))
    ap.add_argument("--out", default=str(ROOT / "教学"))
    args = ap.parse_args()

    src = Path(args.src)
    data = src / "data"
    if not (data / "topics.json").exists():
        sys.exit("找不到源数据：%s" % (data / "topics.json"))

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    topics = load(data / "topics.json")
    deps = load(data / "dependencies.json")
    questions = load(data / "questions.json")

    manifest = {"source": str(src), "subjects": {}}

    for subject, prefix in PRIMARY_PREFIX.items():
        sub_topics = [t for t in topics if t["id"].startswith(prefix)]
        ids = {t["id"] for t in sub_topics}
        sub_deps = [
            e for e in deps if e.get("topicId") in ids and e.get("prerequisiteId") in ids
        ]
        sub_qs = [q for q in questions if q.get("topicId") in ids]

        (out / ("topics.%s.json" % subject)).write_text(
            json.dumps(sub_topics, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        (out / ("dependencies.%s.json" % subject)).write_text(
            json.dumps(sub_deps, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        (out / ("questions.%s.json" % subject)).write_text(
            json.dumps(sub_qs, ensure_ascii=False, indent=1), encoding="utf-8"
        )

        grades = {}
        for t in sub_topics:
            grades[t.get("grade")] = grades.get(t.get("grade"), 0) + 1
        manifest["subjects"][subject] = {
            "prefix": prefix,
            "topics": len(sub_topics),
            "dependencies": len(sub_deps),
            "questions": len(sub_qs),
            "grades": {str(k): v for k, v in sorted(grades.items())},
        }
        print(
            "✓ %-8s 知识点 %4d  先修边 %4d  题目 %4d  年级分布 %s"
            % (subject, len(sub_topics), len(sub_deps), len(sub_qs), manifest["subjects"][subject]["grades"])
        )

    # 课标条目：只留小学用得到的（小学数学/英语/语文）
    std_path = data / "cn-curriculum-standards.json"
    if std_path.exists():
        std = load(std_path)
        keep = []
        if isinstance(std, list):
            for row in std:
                sid = row.get("id", "")
                if sid.startswith(("cms-", "ces-", "ccs-")):
                    keep.append(row)
        else:
            keep = std
        (out / "standards.json").write_text(
            json.dumps(keep, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print("✓ 课标条目 %d" % len(keep))

    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("✓ %s/manifest.json" % out)


if __name__ == "__main__":
    main()

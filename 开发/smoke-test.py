#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
端到端冒烟测试：把主要接口和判分逻辑跑一遍。

用法：
    # 先起服务（开发模式带 PREVIEW=1 方便测未来日期）
    cd server && PREVIEW=1 node src/index.js &
    python3 开发/smoke-test.py

退出码 0 表示全部通过。
"""

import json
import os
import sys
from http.cookiejar import CookieJar
import urllib.error
import urllib.request

BASE = os.environ.get("BASE_URL", "http://localhost:4000")
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
passed = 0
failed = 0


def get(path):
    with opener.open(BASE + path) as r:
        return json.loads(r.read())


def post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener.open(req) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"__http_error": e.code, "body": e.read().decode()[:300]}


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print("  ✓ %s" % name)
    else:
        failed += 1
        print("  ✗ %s  %s" % (name, detail))


def part(label, value):
    return {"parts": [{"label": label, "value": value}]}


def main():
    print("== 服务健康 ==")
    health = get("/api/health")
    check("健康检查", health.get("ok") is True, health)

    print("\n== 排期 ==")
    cal = get("/api/homework/calendar?start=2026-10-26&count=28")
    items = cal["items"]
    check("共 28 天", len(items) == 28, len(items))
    check("第 1 天是语文", items[0]["languageSubject"] == "chinese", items[0])
    check("第 2 天是英语", items[1]["languageSubject"] == "english", items[1])
    check("第 1 周 = 前 7 天", all(i["cycle"] == 1 for i in items[:7]))
    check("第 2 周从 11/02 开始", items[7]["date"] == "2026-11-02", items[7]["date"])
    check("数学只排前 14 天", all(i["mathDay"] for i in items[:14]) and not any(i["mathDay"] for i in items[14:]))
    check("语言排满 28 天", all(i["languageIndex"] for i in items))

    d15 = get("/api/homework/date/2026-11-09")
    check("第 15 天只有语文", d15["chinese"] is not None and d15["english"] is None)
    check("第 15 天语文 = 朱子家训", d15["chinese"]["title"] == "朱子家训（节选）", d15["chinese"]["title"])
    d28 = get("/api/homework/date/2026-11-22")
    check("第 28 天英语 = 睡前和早起", d28["english"]["theme"] == "睡前和早起", d28["english"]["theme"])

    print("\n== 作业内容 ==")
    d1 = get("/api/homework/date/2026-10-26")
    check("数学 5 个题型", len(d1["math"]["groups"]) == 5)
    check("数学 10 题", sum(len(g["questions"]) for g in d1["math"]["groups"]) == 10)
    check("未解锁时不返回语文内容", d1["chineseUnlocked"] or d1["chinese"] is None)
    check("语文 3 问", len(d15["chinese"]["questions"]) == 3)
    check("语文有参考思路和讲解", all(q["reference"] and q["explanation"] for q in d15["chinese"]["questions"]))
    check("编程有提示词", len(d1["coding"]["prompts"]) >= 1)
    check("编程有步骤", len(d1["coding"]["steps"]) >= 3)

    print("\n== 数学自动判分 ==")
    answers = {
        "arith-1": part("答案", "4"),
        "arith-2": part("答案", "144"),
        "addsub-3": part("答案", "6245"),
        "addsub-4": part("答案", "4127"),
        "remainder-5": {"parts": [{"label": "商", "value": "7"}, {"label": "余", "value": "5"}]},
        "remainder-6": {"parts": [{"label": "商", "value": "6"}, {"label": "余", "value": "5"}]},
        "word-7": {"parts": [{"label": "答案", "value": "25"}], "text": "32 + 18 - 25 = 25"},
        "word-8": {"parts": [{"label": "答案", "value": "48"}], "text": "12 x 4 = 48"},
        "extend-9": part("下一个数", "10"),
        "extend-10": part("下一个图形", "圆"),
    }
    r = post("/api/homework/submit", {"date": "2026-10-26", "subject": "math", "answers": answers})
    by_key = {x["key"]: x for x in r.get("results", [])}
    # 这几题是纯规则判分，结果必须是确定的；应用题和开放题走 AI，不做硬性断言
    for key in ["arith-1", "arith-2", "addsub-3", "addsub-4", "remainder-5", "remainder-6", "extend-9", "extend-10"]:
        check("%s 判为对" % key, by_key.get(key, {}).get("status") == "correct", by_key.get(key))
    check("总分在 70 以上", r.get("score", 0) >= 70, r.get("score"))
    check("每题都有反馈", len(r.get("results", [])) == 10, len(r.get("results", [])))

    print("\n== 做错会进错题本 ==")
    bad = dict(answers)
    bad["arith-1"] = part("答案", "5")
    r2 = post("/api/homework/submit", {"date": "2026-10-26", "subject": "math", "answers": bad})
    check("分数下降", r2.get("score", 100) < r.get("score", 0), (r2.get("score"), r.get("score")))
    check("至少有 1 道错题", r2.get("wrongCount", 0) >= 1, r2.get("wrongCount"))
    arith1 = [x for x in r2["results"] if x["key"] == "arith-1"][0]
    check("判为错", arith1["status"] == "wrong", arith1)
    check("给出正确答案", "4" in arith1.get("message", ""), arith1.get("message"))
    locked = post("/api/homework/submit", {"date": "2026-10-26", "subject": "chinese", "answers": {}})
    check("数学有错时不能提交语文", locked.get("__http_error") == 403, locked)
    corrected = post("/api/homework/correct", {"date": "2026-10-26", "subject": "math", "questionKey": "arith-1", "answers": {"arith-1": part("答案", "4")}})
    check("订正只提交一题但返回完整成绩", corrected.get("total") == 10 and any(q["key"] == "arith-1" and q["status"] == "correct" for q in corrected.get("results", [])))

    print("\n== 错题本按科目 + 周期 ==")
    wb = get("/api/review/wrong?subject=all")
    math_group = [g for g in wb["groups"] if g["subject"] == "math"]
    check("有数学分组", len(math_group) == 1, wb["groups"])
    if math_group:
        cycles = math_group[0]["cycles"]
        check("归到第 1 周", cycles and cycles[0]["cycle"] == 1, cycles)
        check("周期范围正确", cycles and cycles[0]["range"]["start"] == "2026-10-26", cycles and cycles[0]["range"])
        check("错题带知识点", cycles and cycles[0]["items"][0]["knowledgePoint"], cycles and cycles[0]["items"][0])

    print("\n== 数独做错要指出位置 ==")
    bad_grid = [["1", "2", "3", "3"], ["3", "4", "1", "2"], ["2", "1", "4", "3"], ["4", "3", "2", "1"]]
    bad2 = {"extend-9": {"parts": [{"label": "数独", "value": bad_grid}]}}
    r3 = post("/api/homework/submit", {"date": "2026-10-27", "subject": "math", "answers": bad2})
    sud = [x for x in r3["results"] if x["key"] == "extend-9"][0]
    check("数独判为错", sud["status"] == "wrong", sud)
    check("指出重复位置", "重复" in sud.get("message", ""), sud.get("message"))

    print("\n== 简化拓展题 ==")
    d2 = get("/api/homework/date/2026-10-27")
    ext10 = [g for g in d2["math"]["groups"] if g["key"] == "extend"][0]["questions"][1]
    check("替换为凑十练习", ext10["answer"]["parts"][0]["value"] == 7, ext10)
    check("简化拓展题无需 AI", not any(q["answer"]["aiText"] for group in d2["math"]["groups"] if group["key"] == "extend" for q in group["questions"]))

    print("\n== 英语选择题 ==")
    d3 = get("/api/homework/date/2026-10-27")
    ex = d3["englishExercises"]
    check("有听音选择", len(ex["listening"]) == 2, len(ex["listening"]))
    check("有跟读句子", len(ex["shadowing"]) >= 3, len(ex["shadowing"]))
    check("每题 4 个选项", all(len(q["options"]) == 4 for q in ex["listening"]))
    check("正确项在选项里", all(q["answer"] in q["options"] for q in ex["listening"]))

    print("\n== 编程作业 ==")
    check("有提示词", len(d1["coding"]["prompts"]) >= 1)
    check("提示词有正文", all(p["text"] for p in d1["coding"]["prompts"]))
    check("有今天的收获", bool(d1["coding"]["gain"]))
    projects = get("/api/homework/projects")
    check("两个项目", set(projects) == {"star", "space"}, list(projects))
    check("星星捕手 6 条规则", len(projects["star"]["rules"]) == 6, len(projects["star"]["rules"]))
    check("太空采矿记 7 条规则", len(projects["space"]["rules"]) == 7, len(projects["space"]["rules"]))
    check("自查清单 7 项", len(projects["star"]["checklist"]) == 7, len(projects["star"]["checklist"]))

    print("\n== 编程笔记 ==")
    post("/api/homework/coding-note", {"date": "2026-10-26", "gain": "G", "learned": "L", "checklist": {"1": True}})
    note = get("/api/homework/coding-note/2026-10-26")
    check("笔记已保存", note["gain"] == "G" and note["learned"] == "L", note)

    print("\n== 家长区 ==")
    check("PIN 正确", post("/api/parent/login", {"pin": "0000"}).get("ok") is True)
    check("PIN 错误被拒", post("/api/parent/login", {"pin": "9999"}).get("ok") is False)
    answers_list = get("/api/parent/answers")
    check("14 天参考答案", len(answers_list) == 14, len(answers_list))

    print("\n== 知识点图谱 ==")
    g = get("/api/graph/topics?subject=math&maxGrade=2")
    check("1-2 年级知识点", len(g["topics"]) > 0, len(g["topics"]))
    check("有先修边", len(g["dependencies"]) > 0, len(g["dependencies"]))
    if g["topics"]:
        detail = get("/api/graph/topic/%s?subject=math" % g["topics"][0]["id"])
        check("知识点有讲解", bool(detail["topic"]["description"]))
        check("知识点有题目", len(detail["questions"]) == 4, len(detail["questions"]))

    print("\n== 学习报告 ==")
    rep = get("/api/review/report")
    check("有科目统计", len(rep["subjects"]) > 0, rep["subjects"])
    check("有每日趋势", len(rep["byDate"]) > 0, len(rep["byDate"]))

    print("\n== 监控会话 ==")
    s = post("/api/watch/sessions", {"date": "2026-10-26"})
    check("创建会话", bool(s.get("sessionId")), s)

    print("\n%s\n通过 %d 项，失败 %d 项" % ("-" * 40, passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

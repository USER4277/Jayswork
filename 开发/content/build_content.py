#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把《小学14天作业本_数学语文英语编程.docx》解析成结构化的 作业/homework.json。

设计要点（全部来自对源 docx 的实测核对）：
  * 文档没有任何空行 —— 所有切分都靠内容标记，不能靠空行。
  * 每天的「三、编程作业」整段被原样复制了两遍（14 天全部如此，逐行一致）→ 取第一份。
  * 正文用全角标点（＝ ÷ − ＋ － ……）和全角空格 U+3000 —— 比对前先 NFKC 归一化。
  * 数独/图形题用表格承载：空字符串 = 待填格，数字 = 题目给定值。
  * day12 的「一笔画」图是 1 列 7 行的 ASCII 画，不是网格 —— 单独处理。
  * day9 的「数图形」图是 3×3 全空网格（每边三等分），没有答案表。
  * 数学答案全部在文末《数学参考答案》，语文答案在《语文参考答案》，按「第 N 天」对齐。

用法：
    python3 开发/content/build_content.py
    python3 开发/content/build_content.py --docx <路径> --out <路径>
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import unicodedata
from pathlib import Path

try:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph
except ImportError:
    sys.exit("需要 python-docx：pip3 install python-docx")

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DOCX = ROOT.parent / "小学14天作业本_数学语文英语编程.docx"

IDEO_SPACE = "　"  # U+3000


# --------------------------------------------------------------------------
# 文档读取：把 body 拆成有序的 ('p', text) / ('tbl', rows) 块
# --------------------------------------------------------------------------

def read_blocks(path):
    d = docx.Document(str(path))
    blocks = []
    for child in d.element.body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            text = Paragraph(child, d).text.strip()
            if text:
                blocks.append(("p", text))
        elif tag == "tbl":
            table = Table(child, d)
            rows = []
            for tr in table.rows:
                cells = []
                for tc in tr.cells:
                    cell_paras = [p.text.strip() for p in tc.paragraphs if p.text.strip()]
                    cells.append(" / ".join(cell_paras))
                rows.append(cells)
            if rows:
                blocks.append(("tbl", rows))
    return blocks


def nfkc(s):
    """全角 → 半角，并把 U+3000 折叠成普通空格。"""
    return unicodedata.normalize("NFKC", s).replace(IDEO_SPACE, " ").strip()


def key(s):
    """结构比对用的规范化形式。

    NFKC 会把【】（）这些中文标点拆成 ASCII 方括号/圆括号，而文档里的章节标记
    （【今天的目标】、（一）四则运算、问题 1：）都依赖中文标点，所以做完 NFKC
    再把它们还原回去。
    """
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("[", "【").replace("]", "】")
    s = s.replace("(", "（").replace(")", "）")
    s = s.replace(":", "：")
    return s.replace(IDEO_SPACE, " ").strip()


def norm(s):
    """结构比对：去空白 + 中文标点还原。"""
    return re.sub(r"\s+", "", key(s))


def find_p(blocks, pred, start=0):
    for i in range(start, len(blocks)):
        kind, val = blocks[i]
        if kind == "p" and pred(val):
            return i
    return -1


def find_all_p(blocks, pred, start=0):
    out = []
    for i in range(start, len(blocks)):
        kind, val = blocks[i]
        if kind == "p" and pred(val):
            out.append(i)
    return out


# --------------------------------------------------------------------------
# 数学：正文题目
# --------------------------------------------------------------------------

MATH_CATS = [
    ("（一）", "arith", "四则运算"),
    ("（二）", "addsub", "1 万以内加减法"),
    ("（三）", "remainder", "余数计算"),
    ("（四）", "word", "应用题"),
    ("（五）", "extend", "思维拓展题"),
]
CAT_HEADER_PRED = {
    "arith": lambda t: norm(t).startswith("（一）四则运算"),
    "addsub": lambda t: norm(t).startswith("（二）1万以内加减法"),
    "remainder": lambda t: norm(t).startswith("（三）余数计算"),
    "word": lambda t: norm(t).startswith("（四）应用题"),
    "extend": lambda t: norm(t).startswith("（五）思维拓展题"),
}

QUESTION_RE = re.compile(r"^(\d{1,2})\s*[.．]\s*(.*)$", re.S)
ANSWER_BLANK_RE = re.compile(r"^答：_{10,}$")
SUDOKU_CAPTION_RE = re.compile(r"^（\s*数独\s*）$")


def split_math_section(blocks):
    """把数学区块切成 5 个类别，每个类别是 [(no, text, figure_rows_or_None, extra_lines)] 。"""
    out = {ckey: [] for _, ckey, _ in MATH_CATS}
    cat = None
    cur = None
    for kind, val in blocks:
        if kind == "p":
            for _, ckey, _ in MATH_CATS:
                if CAT_HEADER_PRED[ckey](val):
                    cat = ckey
                    break
            else:
                if cat is None:
                    continue
                m = QUESTION_RE.match(val)
                if m and int(m.group(1)) <= 10:
                    cur = {
                        "no": int(m.group(1)),
                        "text": m.group(2).strip(),
                        "figure": None,
                        "notes": [],
                    }
                    out[cat].append(cur)
                elif cur is not None and not ANSWER_BLANK_RE.match(val) and not SUDOKU_CAPTION_RE.match(key(val)):
                    cur["notes"].append(val)
        else:  # table
            if cur is not None and cur["figure"] is None:
                cur["figure"] = val
    return out


# --------------------------------------------------------------------------
# 数学：答案区
# --------------------------------------------------------------------------

def parse_math_key(blocks):
    """返回 {day: {cat: {no: {'text':…, 'answer':…, 'figure':…}}}}"""
    start = find_p(blocks, lambda t: t.startswith("数学参考答案"))
    end = find_p(blocks, lambda t: t.startswith("语文参考答案"), start)
    region = blocks[start:end]

    keydata = {}
    day = None
    cat = None
    cur = None
    for kind, val in region:
        if kind == "p":
            m = re.match(r"^第\s*(\d+)\s*天\s*数学参考答案$", key(val))
            if m:
                day = int(m.group(1))
                keydata.setdefault(day, {})
                cat = None
                continue
            if val.startswith("语文参考答案"):
                break
            for _, k, _ in MATH_CATS:
                if CAT_HEADER_PRED[k](val):
                    cat = k
                    keydata.setdefault(day, {}).setdefault(cat, {})
                    break
            else:
                m = QUESTION_RE.match(val)
                if m and cat is not None:
                    no = int(m.group(1))
                    cur = {"text": m.group(2).strip(), "figure": None, "answer_line": None}
                    keydata[day][cat][no] = cur
                elif cur is not None and val.startswith("答："):
                    cur["answer_line"] = val[2:].strip()
        else:
            if cur is not None and cur["figure"] is None:
                cur["figure"] = val
    return keydata


def numbers_in(text):
    """取出文本里的阿拉伯数字（忽略中文数字，避免把「四个角」当成 4）。"""
    return [int(x) for x in re.findall(r"\d+", nfkc(text))]


def value_after_eq(text):
    t = nfkc(text)
    if "=" in t:
        tail = t.split("=")[-1]
        nums = numbers_in(tail)
        if nums:
            return nums[-1]
    nums = numbers_in(t)
    return nums[-1] if nums else None


def quotient_remainder(text):
    t = nfkc(text)
    m = re.search(r"=\s*(\d+)\s*(?:\.{2,}|…+)\s*(\d+)", t)
    if m:
        return int(m.group(1)), int(m.group(2))
    nums = numbers_in(t)
    if len(nums) >= 2:
        return nums[-2], nums[-1]
    return None, None


# --------------------------------------------------------------------------
# 拓展题（28 题）逐题定义答案形态
# --------------------------------------------------------------------------

def _grid_part(fig_rows):
    grid = [[(c or "").strip() for c in row] for row in fig_rows]
    return {
        "kind": "grid",
        "label": "数独",
        "rows": len(grid),
        "cols": len(grid[0]) if grid else 0,
        "given": grid,
    }


def _expr_parts(question_text, count):
    """从「用 2、3、4、5 四个数字 … 算出 24」里抠出数字和目标值。"""
    t = key(question_text)
    nums = []
    m = re.search(r"用\s*([\d、,，\s]+?)\s*四个数字", t)
    if m:
        nums = [int(x) for x in re.findall(r"\d+", m.group(1))]
    target = 24
    m2 = re.search(r"算出\s*(\d+)", t)
    if m2:
        target = int(m2.group(1))
    return [
        {
            "kind": "expression",
            "label": "算式 %d" % (i + 1),
            "numbers": nums,
            "target": target,
        }
        for i in range(count)
    ]


def build_extend_answer(day, no, question, key_item):
    """返回 {'parts': [...], 'aiText': bool, 'aiPrompt': str}"""
    qtext = key(question["text"])
    key_text = key_item["text"] if key_item else ""
    key_full = key_text + (" " + key_item["answer_line"] if key_item and key_item.get("answer_line") else "")

    def keynums():
        return numbers_in(key_full)

    # ---- 数独（day 1/3/5/10/12 的第 9 题）----
    if question.get("figure") and ("数独" in qtext or "宫" in qtext):
        rows = len(question["figure"])
        cols = len(question["figure"][0]) if question["figure"] else 0
        box_rows, box_cols = (2, 2) if rows == 4 else (2, 3)
        values = cols
        part = _grid_part(question["figure"])
        part.update({"boxRows": box_rows, "boxCols": box_cols, "values": values})
        solution = None
        if key_item and key_item.get("figure"):
            solution = [[(c or "").strip() for c in row] for row in key_item["figure"]]
        return {"parts": [part], "aiText": False, "solution": solution}

    # ---- 24 点（day 2#10, 8#9, 11#9, 13#9）----
    if "24" in qtext and "四个数字" in qtext:
        count = 2
        parts = _expr_parts(question["text"], count)
        return {"parts": parts, "aiText": day == 13, "aiPrompt": "为什么有的数字组合能解出来，有的解不出来？" if day == 13 else ""}

    # ---- day 1#10 猜数字 ----
    if day == 1 and no == 10:
        return {"parts": [], "aiText": True, "aiPrompt": "说明你从哪个数开始猜，以及为什么这样猜最快。"}

    # ---- day 2#9 巧算 1+2+…+20 ----
    if day == 2 and no == 9:
        nums = keynums()
        return {
            "parts": [{"kind": "number", "label": "答案", "value": nums[0] if nums else None}],
            "aiText": True,
            "aiPrompt": "写出你的巧算方法，以及用了多长时间。",
        }

    # ---- day 3#10 骰子 ----
    if day == 3 and no == 10:
        nums = keynums()
        return {
            "parts": [{"kind": "number", "label": "一共有多少种", "value": nums[0] if nums else None}],
            "aiText": True,
            "aiPrompt": "用表格、画图或列举的方式说明你找出了哪几种。",
        }

    # ---- day 4#9 规律侦探 ----
    if day == 4 and no == 9:
        nums = keynums()
        return {
            "parts": [{"kind": "number", "label": "括号里的数", "value": nums[0] if nums else None}],
            "aiText": True,
            "aiPrompt": "写出你发现的规律，并再编一列有规律的数。",
        }

    # ---- day 4#10 谁是第一名 ----
    if day == 4 and no == 10:
        order = [None, None, None]
        rank_of = {"第一": 1, "第二": 2, "第三": 3, "最少": 3, "最后": 3}
        for who, pos in re.findall(r"(甲|乙|丙)(第一|第二|第三|最少|最后)", key_full):
            order[rank_of[pos] - 1] = who
        return {
            "parts": [{"kind": "ranking", "label": "名次（第一名 → 第三名）", "options": ["甲", "乙", "丙"], "value": order}],
            "aiText": True,
            "aiPrompt": "说说你的推理过程。",
        }

    # ---- day 5#10 小小采购员 ----
    if day == 5 and no == 10:
        m = re.search(r"数量最多的是买\s*(\d+)", key_full)
        return {
            "parts": [
                {
                    "kind": "lines",
                    "label": "买法（写 5 种）",
                    "rows": 5,
                    "items": [
                        {"name": "笔记本", "price": 4},
                        {"name": "铅笔", "price": 2},
                        {"name": "橡皮", "price": 1},
                        {"name": "棒棒糖", "price": 3},
                    ],
                    "budget": 10,
                },
                {"kind": "number", "label": "哪种买法数量最多？买到了多少件", "value": int(m.group(1)) if m else None},
            ],
            "aiText": True,
            "aiPrompt": "说明为什么这种买法买到的数量最多。",
        }

    # ---- day 6#9 火柴棒 ----
    if day == 6 and no == 9:
        return {"parts": [], "aiText": True, "aiPrompt": "画出你的摆法，说明用了 12 根火柴怎么摆出 4 个正方形。"}

    # ---- day 6#10 图形接龙 ----
    if day == 6 and no == 10:
        a, b = None, None
        m = re.search(r"第\s*20\s*个(?:图形)?是[^，。]*?[“\"]?([^，。]*?)[”\"]?[。，]", key_full)
        if m:
            a = m.group(1).strip()
        m2 = re.search(r"第\s*33\s*个(?:图形)?是[^，。]*?[“\"]?([^，。]*?)[”\"]?[。，]", key_full)
        if m2:
            b = m2.group(1).strip()
        for cand in ("三角", "方形", "圆"):
            if a and cand in a:
                a = cand
            if b and cand in b:
                b = cand
        return {
            "parts": [
                {"kind": "choice", "label": "第 20 个图形", "options": ["圆", "三角", "方形"], "value": a},
                {"kind": "choice", "label": "第 33 个图形", "options": ["圆", "三角", "方形"], "value": b},
            ],
            "aiText": False,
        }

    # ---- day 7#9 鸡兔同笼 ----
    if day == 7 and no == 9:
        chicken = rabbit = None
        m = re.search(r"兔\s*(\d+)\s*只[，,]\s*鸡\s*(\d+)\s*只", key_full)
        if m:
            rabbit, chicken = int(m.group(1)), int(m.group(2))
        return {
            "parts": [
                {"kind": "number", "label": "鸡有多少只", "value": chicken},
                {"kind": "number", "label": "兔有多少只", "value": rabbit},
            ],
            "aiText": True,
            "aiPrompt": "写出你的方法（比如假设法），并验算一下。",
        }

    # ---- day 7#10 抽屉原理 ----
    if day == 7 and no == 10:
        nums = keynums()
        return {
            "parts": [{"kind": "number", "label": "至少要摸出几个", "value": nums[0] if nums else None}],
            "aiText": True,
            "aiPrompt": "解释为什么摸这么多个就一定能保证有 2 个同色。",
        }

    # ---- day 8#10 天平称重 ----
    if day == 8 and no == 10:
        nums = keynums()
        return {
            "parts": [{"kind": "number", "label": "最少称几次", "value": nums[0] if nums else None}],
            "aiText": True,
            "aiPrompt": "说明你的方法（怎么分组、怎么判断）。",
        }

    # ---- day 9#9 火柴棒升级 ----
    if day == 9 and no == 9:
        four = five = None
        m = re.search(r"围出\s*(\d+)\s*个一样大", key_full)
        if m:
            four = int(m.group(1))
        m2 = re.search(r"能摆出\s*(\d+)\s*个", key_full)
        if m2:
            five = int(m2.group(1))
        return {
            "parts": [
                {"kind": "number", "label": "① 先摆出几个一样大的正方形", "value": four},
                {"kind": "number", "label": "② 12 根火柴最多能摆出几个正方形", "value": five},
            ],
            "aiText": True,
            "aiPrompt": "画出你的摆法，并数一数一共几个正方形。",
        }

    # ---- day 9#10 数图形 ----
    if day == 9 and no == 10:
        sq = rect = None
        m = re.search(r"正方形一共\s*(\d+)\s*个", key_full)
        if m:
            sq = int(m.group(1))
        m2 = re.search(r"长方形一共\s*(\d+)\s*个", key_full)
        if m2:
            rect = int(m2.group(1))
        return {
            "parts": [
                {"kind": "number", "label": "① 一共有多少个正方形", "value": sq},
                {"kind": "number", "label": "② 一共有多少个长方形", "value": rect},
            ],
            "aiText": False,
        }

    # ---- day 10#10 平均数 ----
    if day == 10 and no == 10:
        # ① 的答案 = 第一个「…分」；② 的答案 = 第二段的最后一个「…分」
        seg1, _, seg2 = key_full.partition("②")
        m1 = re.findall(r"(\d+)\s*分", seg1)
        m2 = re.findall(r"(\d+)\s*分", seg2)
        return {
            "parts": [
                {"kind": "number", "label": "① 4 次的平均分", "value": int(m1[-1]) if m1 else None},
                {"kind": "number", "label": "② 第 5 次至少要考多少分", "value": int(m2[-1]) if m2 else None},
            ],
            "aiText": False,
        }

    # ---- day 11#10 称球找次品 ----
    if day == 11 and no == 10:
        nums = keynums()
        return {
            "parts": [{"kind": "number", "label": "最少称几次", "value": nums[0] if nums else None}],
            "aiText": True,
            "aiPrompt": "写出你的方法（怎么分组、怎么判断轻重）。",
        }

    # ---- day 12#10 一笔画 ----
    if day == 12 and no == 10:
        odd = None
        can = None
        m = re.search(r"有\s*(\d+)\s*个奇点", key_full)
        if m:
            odd = int(m.group(1))
        if "不能" in key_full:
            can = "不能"
        return {
            "parts": [
                {"kind": "choice", "label": "能不能一笔画完", "options": ["能", "不能"], "value": can},
                {"kind": "number", "label": "图中有几个奇点", "value": odd},
            ],
            "aiText": True,
            "aiPrompt": "说说你的理由。",
        }

    # ---- day 13#10 抽屉原理升级 ----
    if day == 13 and no == 10:
        m1 = re.search(r"①\s*(\d+)", key_full)
        m2 = re.search(r"②\s*(\d+)", key_full)
        return {
            "parts": [
                {"kind": "number", "label": "① 摸几个才能保证 4 个里有 2 个同色", "value": int(m1.group(1)) if m1 else None},
                {"kind": "number", "label": "② 摸几个才能保证 5 个里有 3 个同色", "value": int(m2.group(1)) if m2 else None},
            ],
            "aiText": True,
            "aiPrompt": "用「抽屉」的方法验证你的答案。",
        }

    # ---- day 14#9 设计数学游戏 / day 14#10 小小数学家 ----
    if day == 14:
        return {
            "parts": [],
            "aiText": True,
            "aiPrompt": qtext[:120],
        }

    # 兜底：当作开放题交给 AI
    return {"parts": [], "aiText": True, "aiPrompt": qtext[:120]}


def build_word_answer(question, key_item):
    """应用题：最终数值从答案区的「答：」行里取阿拉伯数字。"""
    kitem = key_item or {}
    answer_line = kitem.get("answer_line") or ""
    expr = kitem.get("text") or ""
    parts = []
    # 注意：NFKC 会把「……」拆成一串点，所以这里用原文判断
    if "……" in expr or "..." in expr:
        q, r = quotient_remainder(expr)
        parts = [
            {"kind": "number", "label": "商", "value": q},
            {"kind": "number", "label": "余", "value": r},
        ]
    else:
        nums = numbers_in(answer_line)
        if not nums:
            nums = numbers_in(expr)
        for i, v in enumerate(nums):
            label = "答案"
            if len(nums) == 2:
                label = "答案 ①" if i == 0 else "答案 ②"
            parts.append({"kind": "number", "label": label, "value": v})
    return {"parts": parts, "aiText": True, "aiPrompt": "请写出你的计算过程，并说明每一步是怎么想的。"}


def build_math_day(day, math_body, math_key):
    groups = []
    cat_meta = [
        ("arith", "四则运算", "每题含两种运算，且带括号", "number"),
        ("addsub", "1 万以内加减法", "1 万以内的加法和减法，注意进位与退位", "number"),
        ("remainder", "余数计算", "写出商和余数", "numbers"),
        ("word", "应用题", "请写出计算过程", "number"),
        ("extend", "思维拓展题", "动动脑筋", "mixed"),
    ]
    for ckey, title, hint, mode in cat_meta:
        qs = []
        for q in math_body.get(ckey, []):
            no = q["no"]
            k = math_key.get(day, {}).get(ckey, {}).get(no)
            item = {
                "no": no,
                "prompt": key(q["text"]),
                "rawPrompt": q["text"],
                "figure": None,
                "notes": [key(x) for x in q["notes"] if key(x)],
            }
            if ckey == "word":
                ans = build_word_answer(q, k)
            elif mode == "number":
                ans = {"parts": [{"kind": "number", "label": "答案", "value": value_after_eq(k["text"]) if k else None}]}
            elif mode == "numbers":
                qv, rv = quotient_remainder(k["text"]) if k else (None, None)
                ans = {
                    "parts": [
                        {"kind": "number", "label": "商", "value": qv},
                        {"kind": "number", "label": "余", "value": rv},
                    ]
                }
            else:
                ans = build_extend_answer(day, no, q, k)

            if ckey == "extend" and ans.get("parts") and ans["parts"][0].get("kind") == "grid":
                # 数独：答案部件本身就是可填网格（带给定值、宫划分、数字范围），
                # 判分和渲染都用它；figure 只留布局提示。
                grid_part = ans["parts"][0]
                item["figure"] = {
                    "type": "sudoku",
                    "rows": grid_part["rows"],
                    "cols": grid_part["cols"],
                    "boxRows": grid_part["boxRows"],
                    "boxCols": grid_part["boxCols"],
                    "values": grid_part["values"],
                }
                item["solution"] = ans.get("solution")
                ans["aiText"] = False
            if ckey == "extend" and day == 9 and no == 10:
                item["figure"] = {"type": "grid3", "rows": 3, "cols": 3}
            if ckey == "extend" and day == 12 and no == 10:
                item["figure"] = {"type": "ascii", "lines": [r[0] for r in q["figure"]] if q.get("figure") else []}

            item["answer"] = ans
            item["reference"] = (k["text"] + ("　" + k["answer_line"] if k and k.get("answer_line") else "")) if k else ""
            qs.append(item)
        groups.append({"key": ckey, "title": title, "hint": hint, "questions": qs})
    return {"groups": groups}


# --------------------------------------------------------------------------
# 语文
# --------------------------------------------------------------------------

def parse_chinese(blocks, day):
    body = blocks
    idx = find_p(body, lambda t: norm(t).startswith("阅读材料："))
    if idx < 0:
        return None
    header = body[idx][1]
    rest = header.split("：", 1)[1].strip()
    title, source = rest, ""
    m = re.match(r"^(.*)（([^（）]*)）$", rest)
    if m:
        title, source = m.group(1).strip(), m.group(2).strip()

    passage = ""
    if idx + 1 < len(body) and body[idx + 1][0] == "tbl":
        passage = body[idx + 1][1][0][0]

    questions = []
    for i in range(idx + 1, min(idx + 12, len(body))):
        kind, val = body[i]
        if kind != "p":
            continue
        m = re.match(r"^问题\s*(\d)\s*[：:]\s*(.*)$", key(val))
        if m:
            questions.append({"no": int(m.group(1)), "prompt": m.group(2).strip(), "reference": ""})
        if len(questions) == 3:
            break
    return {"title": title, "source": source, "passage": passage, "questions": questions}


def parse_chinese_key(blocks):
    start = find_p(blocks, lambda t: t.startswith("语文参考答案"))
    region = blocks[start:]
    out = {}
    day = None
    for kind, val in region:
        if kind != "p":
            continue
        t = key(val)
        m = re.match(r"^第\s*(\d+)\s*天\s+(.*)$", t)
        if m and "参考答案" not in val:
            day = int(m.group(1))
            out[day] = {}
            continue
        m2 = re.match(r"^问题\s*(\d)\s*参考答案：\s*(.*)$", t)
        if m2 and day is not None:
            out[day][int(m2.group(1))] = m2.group(2).strip()
        if val.startswith("附录："):
            break
    return out


# --------------------------------------------------------------------------
# 英语
# --------------------------------------------------------------------------

def parse_english(blocks):
    out = {"theme": "", "scene": "", "dialogues": [], "sentences": [], "task": "", "tip": "", "parentTip": ""}
    i = 0
    while i < len(blocks):
        kind, val = blocks[i]
        if kind == "tbl" and len(val) == 1 and len(val[0]) == 2:
            label = key(val[0][0])
            if label == "今日主题":
                out["theme"] = val[0][1].strip()
            elif label == "生活场景":
                out["scene"] = val[0][1].strip()
            i += 1
            continue
        if kind == "p":
            t = key(val)
            m = re.match(r"^对话([一二])[ ·]*(.*)$", t)
            if m:
                lines = []
                j = i + 1
                if j < len(blocks) and blocks[j][0] == "tbl":
                    for row in blocks[j][1]:
                        if len(row) < 2:
                            continue
                        # 说话人标签用原文匹配：规范化会把 ':' 还原成全角、NFKC 会把 ① 变成 1
                        sp = re.match(r"^([AB])\s*[:：]\s*(.*)$", row[0])
                        if sp:
                            lines.append({"speaker": sp.group(1), "en": sp.group(2).strip(), "zh": row[1].strip()})
                out["dialogues"].append({"title": m.group(2).strip(), "lines": lines})
                i += 2
                continue
            if t.startswith("·"):
                out["sentences"].append(t[1:].strip())
                i += 1
                continue
            for label, fkey in (
                ("今天的小任务", "task"),
                ("小提示", "tip"),
                ("给家长的提醒", "parentTip"),
            ):
                if t.startswith("【%s】" % label):
                    if i + 1 < len(blocks) and blocks[i + 1][0] == "p":
                        out[fkey] = key(blocks[i + 1][1])
                    i += 2
                    continue
        i += 1
    return out


def _make_options(correct, all_lines, used):
    """给正确句挑 3 个长度相近的同日干扰句，并做确定性洗牌。"""
    pool = [x for x in all_lines if x["en"] != correct["en"] and x["en"] not in used]
    pool.sort(key=lambda x: (abs(len(x["en"]) - len(correct["en"])), x["en"]))
    picked = pool[:3]
    if len(picked) < 3:
        return None
    opts = picked + [correct]
    opts.sort(key=lambda x: hashlib.md5(x["en"].encode("utf-8")).hexdigest())
    return [o["en"] for o in opts]


def build_english_exercises(eng):
    """生成 听→选择 / 中文→英文（对话补全）/ 跟读 三类练习。"""
    all_lines = [l for d in eng["dialogues"] for l in d["lines"]]
    if len(all_lines) < 4:
        return {"listening": [], "dialogue": [], "shadowing": []}

    # 跟读：对话一的句子
    d1 = eng["dialogues"][0]["lines"] if eng["dialogues"] else []
    shadowing = [{"en": l["en"], "zh": l["zh"]} for l in d1[:4]]

    # 听→选择：正句 + 3 个同日长度相近的干扰句
    listening = []
    used = set()
    candidates = [l for l in all_lines if l["en"] not in {s["en"] for s in shadowing}] or all_lines
    for line in candidates[:2]:
        options = _make_options(line, all_lines, used)
        if not options:
            continue
        listening.append(
            {
                "type": "listen_choose",
                "prompt": "听一听，选出你听到的句子",
                "audio": line["en"],
                "options": options,
                "answer": line["en"],
            }
        )
        used.add(line["en"])

    # 对话补全：给出中文，选英文
    dialogue = []
    d2 = eng["dialogues"][1]["lines"] if len(eng["dialogues"]) > 1 else []
    for line in d2[:2]:
        options = _make_options(line, all_lines, used)
        if not options:
            continue
        dialogue.append(
            {
                "type": "zh_choose_en",
                "prompt": "这段话用英语怎么说？",
                "audio": line["zh"],
                "options": options,
                "answer": line["en"],
            }
        )
        used.add(line["en"])

    return {"listening": listening, "dialogue": dialogue, "shadowing": shadowing}


# --------------------------------------------------------------------------
# 编程
# --------------------------------------------------------------------------

PROJ_HEADER_RE = re.compile(r"^项目([一二])《(.+?)》\s*·\s*第\s*(\d+)\s*天：(.+)$")


def parse_coding(blocks):
    """编程区块（已去重）→ 结构化。"""
    out = {
        "project": "",
        "projectTitle": "",
        "dayNo": None,
        "dayTitle": "",
        "goal": "",
        "readFirst": "",
        "steps": [],
        "prompts": [],
        "saveTip": "",
        "selfCheck": "",
        "gain": "",
        "learned": "",
    }
    i = 0
    while i < len(blocks):
        kind, val = blocks[i]
        if kind == "p":
            t = key(val)
            m = PROJ_HEADER_RE.match(t)
            if m:
                out["project"] = "项目一" if m.group(1) == "一" else "项目二"
                out["projectTitle"] = m.group(2)
                out["dayNo"] = int(m.group(3))
                out["dayTitle"] = m.group(4).strip()
                i += 1
                continue
            if t.startswith("【今天的目标】"):
                if i + 1 < len(blocks) and blocks[i + 1][0] == "p":
                    out["goal"] = key(blocks[i + 1][1])
                i += 2
                continue
            if t.startswith("【开始之前，先读一读】"):
                if i + 1 < len(blocks) and blocks[i + 1][0] == "tbl":
                    out["readFirst"] = blocks[i + 1][1][0][0]
                i += 2
                continue
            if t.startswith("【今天这样做】"):
                j = i + 1
                while j < len(blocks) and blocks[j][0] == "p" and re.match(r"^第\s*\d+\s*步", key(blocks[j][1])):
                    out["steps"].append(key(blocks[j][1]))
                    j += 1
                i = j
                continue
            if t.startswith("【把下面这段话复制给"):
                j = i + 1
                while j < len(blocks) and blocks[j][0] == "p" and re.match(r"^提示词\s*[①②③]", blocks[j][1]):
                    label = blocks[j][1].strip()
                    text = ""
                    if j + 1 < len(blocks) and blocks[j + 1][0] == "tbl":
                        text = blocks[j + 1][1][0][0]
                    out["prompts"].append({"label": label, "text": text})
                    j += 2
                i = j
                continue
            if t.startswith("【保存小抄"):
                if i + 1 < len(blocks) and blocks[i + 1][0] == "tbl":
                    out["saveTip"] = blocks[i + 1][1][0][0]
                i += 2
                continue
            if t.startswith("【怎么知道自己做对了】"):
                if i + 1 < len(blocks) and blocks[i + 1][0] == "p":
                    out["selfCheck"] = key(blocks[i + 1][1])
                i += 2
                continue
            if t.startswith("【今天的收获】"):
                out["gain"] = t[len("【今天的收获】"):].strip()
                i += 1
                continue
            if t.startswith("【今天我学到的一件事】"):
                out["learned"] = t[len("【今天我学到的一件事】"):].strip()
                i += 1
                continue
        i += 1
    return out


# --------------------------------------------------------------------------
# 项目总览 / 自查清单 / 附录
# --------------------------------------------------------------------------

def parse_projects(blocks):
    start = find_p(blocks, lambda t: t.startswith("编程项目总览"))
    end = find_p(blocks, lambda t: t.startswith("第一周作业"))
    region = blocks[start:end]
    projects = {}
    cur = None
    in_rules = False
    for kind, val in region:
        if kind != "p":
            continue
        t = key(val)
        m = re.match(r"^项目([一二])\s+《(.+?)》$", t)
        if m:
            cur = "star" if m.group(1) == "一" else "space"
            projects[cur] = {"title": m.group(2), "subtitle": "", "rules": [], "checklist": []}
            in_rules = False
            continue
        if cur is None:
            continue
        if t.startswith("第 1～7 天") or t.startswith("第 8～14 天"):
            projects[cur]["subtitle"] = t.split("|")[-1].strip()
            continue
        if t == "游戏规则":
            in_rules = True
            continue
        if in_rules:
            m2 = re.match(r"^(\d+)\.\s*(.+)$", t)
            if m2:
                projects[cur]["rules"].append(m2.group(2).strip())
    return projects


def parse_checklists(blocks):
    start = find_p(blocks, lambda t: t.startswith("编程作业 · 完成情况自查清单"))
    end = find_p(blocks, lambda t: t.startswith("附录：给家长的话"))
    region = blocks[start:end]
    checklists = {"star": [], "space": [], "thinking": []}
    cur = None
    for kind, val in region:
        if kind == "p":
            t = key(val)
            if t.startswith("一、项目一"):
                cur = "star"
            elif t.startswith("二、项目二"):
                cur = "space"
            elif t.startswith("三、思考力"):
                cur = "thinking"
            elif t.startswith("四、"):
                cur = None
        elif kind == "tbl" and cur:
            for row in val:
                if len(row) >= 3 and re.match(r"^\d+$", key(row[0])):
                    checklists[cur].append(
                        {"no": key(row[0]), "item": key(row[1]), "how": key(row[2])}
                    )
    return checklists


def parse_sentence_table(blocks):
    start = find_p(blocks, lambda t: t.startswith("附录：14 天英语句型速查表"))
    region = blocks[start:]
    rows = []
    for kind, val in region:
        if kind != "tbl":
            continue
        for row in val:
            if len(row) >= 4 and re.match(r"^\d+$", key(row[0])):
                rows.append(
                    {
                        "day": int(key(row[0])),
                        "theme": row[1].strip(),
                        "scene": row[2].strip(),
                        "patterns": row[3].strip(),
                    }
                )
        if rows:
            break
    return rows


def parse_guide(blocks, title, stop_prefixes):
    start = find_p(blocks, lambda t: t.startswith(title))
    if start < 0:
        return []
    out = []
    for kind, val in blocks[start + 1:]:
        if kind == "p" and any(val.startswith(s) for s in stop_prefixes):
            break
        if kind == "p":
            out.append(key(val))
    return out


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def build(docx_path, out_path):
    blocks = read_blocks(docx_path)
    math_key = parse_math_key(blocks)
    chinese_key = parse_chinese_key(blocks)

    day_headers = find_all_p(blocks, lambda t: re.match(r"^第\s*\d+\s*天$", key(t)))
    day_headers = [i for i in day_headers if 1 <= int(key(blocks[i][1])[1:-1].strip()) <= 14]
    # 过滤掉答案区里的「第 N 天」：正文区的标题前后没有空格包裹的数字形式，已用全角匹配保证
    day_headers = sorted(set(day_headers))

    days = []
    for k, hdr in enumerate(day_headers):
        day = int(key(blocks[hdr][1])[1:-1].strip())
        end = day_headers[k + 1] if k + 1 < len(day_headers) else len(blocks)
        region = blocks[hdr + 1:end]

        m_start = find_p(region, lambda t: norm(t).startswith("一、数学作业"))
        c_start = find_p(region, lambda t: norm(t).startswith("二、语文作业"))
        p_start = find_p(region, lambda t: norm(t).startswith("三、编程作业"))
        e_start = find_p(region, lambda t: norm(t).startswith("四、英语作业"))
        if -1 in (m_start, c_start, p_start, e_start):
            raise SystemExit("第 %d 天结构不完整" % day)

        math_body = split_math_section(region[m_start + 1:c_start])
        chinese = parse_chinese(region[c_start + 1:p_start], day)
        english = parse_english(region[e_start + 1:])

        # 编程区块去掉重复的第二份
        code_region = region[p_start + 1:e_start]
        proj_idxs = [
            i
            for i, (kind, val) in enumerate(code_region)
            if kind == "p" and PROJ_HEADER_RE.match(key(val))
        ]
        if len(proj_idxs) > 1:
            code_region = code_region[: proj_idxs[1]]
        coding = parse_coding(code_region)

        # 每日副标题
        subtitle = ""
        if k > 0:
            prev = region[0]
        first_p = region[0][1] if region and region[0][0] == "p" else ""
        if re.match(r"^第[一二]周\s*·", key(first_p)):
            subtitle = key(first_p)

        math = build_math_day(day, math_body, math_key)
        if chinese:
            for q in chinese["questions"]:
                q["reference"] = chinese_key.get(day, {}).get(q["no"], "")

        days.append(
            {
                "day": day,
                "week": 1 if day <= 7 else 2,
                "subtitle": subtitle,
                "math": math,
                "chinese": chinese,
                "english": english,
                "englishExercises": build_english_exercises(english),
                "coding": coding,
            }
        )

    days.sort(key=lambda d: d["day"])

    projects = parse_projects(blocks)
    checklists = parse_checklists(blocks)
    for proj_key, ck in checklists.items():
        if proj_key in projects:
            projects[proj_key]["checklist"] = ck

    meta = {
        "source": Path(docx_path).name,
        "dayCount": len(days),
        "anchorStart": "2026-10-26",
        "usageGuide": parse_guide(blocks, "使用说明", ["签名栏", "编程项目总览"]),
        "parentGuide": parse_guide(blocks, "附录：给家长的话", []),
        "sentenceTable": parse_sentence_table(blocks),
        "signatureColumns": ["日期", "数学", "语文", "编程", "家长签字", "备注"],
    }

    payload = {
        "meta": meta,
        "projects": projects,
        "checklists": checklists,
        "days": days,
    }

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # 复制源 docx 到 作业/ 目录，方便日后核对
    try:
        dest = out_path.parent / Path(docx_path).name
        if not dest.exists():
            shutil.copy2(docx_path, dest)
    except Exception as exc:  # pragma: no cover
        print("  (复制源文件失败: %s)" % exc)

    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docx", default=str(DEFAULT_DOCX))
    ap.add_argument("--out", default=str(ROOT / "作业" / "homework.json"))
    args = ap.parse_args()

    if not Path(args.docx).exists():
        sys.exit("找不到 docx：%s" % args.docx)

    payload = build(args.docx, args.out)
    print("✓ %s" % args.out)
    for d in payload["days"]:
        math_qs = sum(len(g["questions"]) for g in d["math"]["groups"])
        cn_q = len(d["chinese"]["questions"]) if d["chinese"] else 0
        en_lines = sum(len(x["lines"]) for x in d["english"]["dialogues"])
        print(
            "  第%2d天  数学%2d题  语文%d问  英语%2d句  编程「%s · 第%d天」%d步/%d提示词"
            % (
                d["day"],
                math_qs,
                cn_q,
                en_lines,
                d["coding"]["projectTitle"],
                d["coding"]["dayNo"] or 0,
                len(d["coding"]["steps"]),
                len(d["coding"]["prompts"]),
            )
        )


if __name__ == "__main__":
    main()

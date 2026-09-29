#!/usr/bin/env python3
# terms_check —— 词表驱动术语残留断言（只读）。plan-lint 检查[7] terms-residue 的执行体。
#
# 规则正本 = skills/plan-protocol/SKILL.md §三「术语残留断言」条；脚本只是执行者，
# 规则改动先改协议。「验」归本脚本；「改」（sweep 替换动作）归各仓术语 SOP，不进本脚本。
#
# 用法：
#   python3 terms_check.py --terms <terms.txt> [--roots <dir,dir,...>]
#                          [--summary-file <path>] [--self-test]
#   plan-lint.sh --terms <terms.txt> 转到本脚本（发现数并入 lint 总数）；
#   各仓 SOP 的 sweep 循环里也可独立跑，只验术语不动治理目录。
#
# 词表行格式（# 开头注释；词为固定串，grep -F 语义）：
#   词                      断言该词无标记残留
#   词<TAB>标记1|标记2      本词专属合法留痕标记
#   旧词 => 新词            建议替换方向（残留报告随之给出）
#   @mark 标记1|标记2       扩充全局留痕标记集
#
# 三条防坑（各对应一次实证事故，novel 2026-09-29 移交文档 §四）：
#   1. UTF-8 原生枚举（os.walk），禁止 git ls-files 裸输出喂循环（quotepath
#      八进制转义把中文文件名整批漏扫）；
#   2. 枚举/处理/排除三计数对账并全打印，不齐即中止（防静默跳过、单命令假绿）；
#   3. 排除区显式清单（见下方常量），豁免数计入对账。
#
# 输出禁套 rtk（其压缩/统计改写已实证失真：diff --stat 报 7363 行实际 29）。
# 退出码：0=无标记残留（⚠ 零命中警告不算发现）/ 1=有残留 / 2=用法或环境错误。
#
# 纯 stdlib；macOS 自带 python3。

import argparse
import fnmatch
import os
import sys
import tempfile

# 全局合法留痕标记默认集（20）。来源 = novel qa/state-machine/protocol_driver.py
# d4() 的 MARKS（2026-09-25 D-4 收口先例）generalize：原三支「旧「强制定稿」/
# 原「强制定稿」/「强制定稿」更名」去词化后并入 旧「/原「/更名 三个子串。
# 行级判定：整行含任一标记（默认集 + @mark 扩充 + 词行专属）即该行全部豁免。
DEFAULT_MARKS = (
    "旧「", "原「", "历史引文", "已废除", "已废弃", "退役", "存照", "口径注",
    "留观", "冻结", "更名", "已废", "快照", "deprecated", "遗留", "当时",
    "旧称", "旧口径", "判据废", "对照",
)

# 排除区显式清单（移交文档 §四.3 原单）。注意目录按名单剪、不做「一切隐藏
# 目录」的泛化剪——.plan/.scratch 虽以点开头，但是必扫的治理活面（novel 参考
# 域清单明确含它们）。隐藏文件（.DS_Store 等）仍按名剪。
EXCLUDE_DIR_NAMES = {".git", ".archive", ".tmp", ".zvec-grep", "node_modules"}
EXCLUDE_SUFFIXES = (
    ".pb.go",                                  # go 生成物
    ".sql",                                    # 迁移冻结史
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".pdf",
    ".zip", ".gz", ".tgz", ".tar", ".jar",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp4", ".mov", ".webm", ".mp3", ".wav",
)
EXCLUDE_NAME_PATTERNS = ("*results*.json",)    # 冻结运行日志
MAX_BYTES = 5 * 1024 * 1024                    # 超上限单文件跳过（计读取跳过）


class UsageError(Exception):
    pass


def parse_terms(path):
    """词表文件 → (terms, marks)；terms = [(词, 建议替换|None), ...]（去重保首个）。"""
    if not os.path.isfile(path):
        raise UsageError(f"词表文件不存在: {path}")
    terms, seen, marks = [], set(), []
    with open(path, encoding="utf-8") as fh:
        for ln, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("@mark"):
                for m in line[len("@mark"):].split("|"):
                    m = m.strip()
                    if m:
                        marks.append(m)
                continue
            # 规范切法：TAB 先切列（列1=标记），`=>` 只在首列内切（词 => 新词）
            cols = line.split("\t")
            head, suggestion = cols[0], None
            if "=>" in head:
                head, _, suggestion = head.partition("=>")
                suggestion = suggestion.strip() or None
            word = head.strip()
            if not word:
                raise UsageError(f"词表第 {ln} 行解析出空词（检查 TAB / => 用法）")
            for m in (cols[1] if len(cols) > 1 else "").split("|"):
                m = m.strip()
                if m:
                    marks.append(m)  # 本词专属标记并入行级豁免池（行级判定）
            if word not in seen:
                seen.add(word)
                terms.append((word, suggestion))
    if not terms:
        raise UsageError(f"词表无有效词行: {path}")
    return terms, marks


def _excluded(path):
    name = os.path.basename(path)
    if name.startswith("."):  # 隐藏文件（目录已按名单在 walk 处剪）
        return True
    if name.endswith(EXCLUDE_SUFFIXES):
        return True
    return any(fnmatch.fnmatch(name, p) for p in EXCLUDE_NAME_PATTERNS)


def iter_files(roots):
    """UTF-8 原生枚举。产出 (路径, 是否排除区)；排除区文件只计数不读取。"""
    seen = set()
    for root in roots:
        if not os.path.exists(root):
            raise UsageError(f"扫描根不存在: {root}")
        if os.path.isfile(root):
            rp = os.path.realpath(root)
            if rp not in seen:
                seen.add(rp)
                yield root, _excluded(root)
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDE_DIR_NAMES)
            pruned = [d for d in sorted(os.listdir(dirpath))
                      if os.path.isdir(os.path.join(dirpath, d))
                      and d in EXCLUDE_DIR_NAMES]
            for d in pruned:
                for dp, _, fns in os.walk(os.path.join(dirpath, d)):
                    for fn in sorted(fns):
                        fp = os.path.join(dp, fn)
                        rp = os.path.realpath(fp)
                        if rp not in seen:
                            seen.add(rp)
                            yield fp, True
            for fn in sorted(filenames):
                fp = os.path.join(dirpath, fn)
                rp = os.path.realpath(fp)
                if rp in seen:
                    continue
                seen.add(rp)
                yield fp, _excluded(fp)


def scan(terms, marks, roots):
    """主扫描（只读：open 只读、不碰 mtime）。返回计数字典与逐词结果。"""
    all_marks = tuple(marks) + DEFAULT_MARKS
    n_live = n_excluded = n_read = n_undecodable = n_oversize = 0
    residues, exempt = {}, {}
    for path, excluded in iter_files(roots):
        if excluded:
            n_excluded += 1
            continue
        n_live += 1
        try:
            if os.path.getsize(path) > MAX_BYTES:
                n_oversize += 1
                continue
            with open(path, encoding="utf-8") as fh:
                lines = fh.read().splitlines()
        except (UnicodeDecodeError, PermissionError, OSError):
            n_undecodable += 1
            continue
        n_read += 1
        for i, line in enumerate(lines, 1):
            hits = [w for w, _ in terms if w in line]
            if not hits:
                continue
            if any(m in line for m in all_marks):
                for w in hits:
                    exempt[w] = exempt.get(w, 0) + 1
                continue
            for w in hits:
                residues.setdefault(w, []).append((path, i))
    # 对账：活面枚举数 == 处理数 + 显式跳过数；不齐即中止（防静默跳过）
    if n_live != n_read + n_undecodable + n_oversize:
        raise AssertionError(f"计数对账失败: 枚举 {n_live} ≠ 处理 {n_read} + "
                             f"跳过 {n_undecodable + n_oversize}")
    counts = dict(live=n_live, excluded=n_excluded, read=n_read,
                  undecodable=n_undecodable, oversize=n_oversize)
    return counts, residues, exempt


def run(terms, marks, roots, out=sys.stdout):
    counts, residues, exempt = scan(terms, marks, roots)
    zero = []
    bad = 0
    print(f"[7] 术语残留（词表 {len(terms)} 词 × 活面 {', '.join(roots)}）", file=out)
    print(f"  扫描文件 {counts['read']}，读取跳过 {counts['undecodable'] + counts['oversize']}"
          f"（不可解码 {counts['undecodable']}、超上限 {counts['oversize']}），"
          f"排除区跳过 {counts['excluded']}"
          f"（{'/'.join(sorted(EXCLUDE_DIR_NAMES))}、隐藏文件、*.pb.go、*.sql、"
          f"*results*.json、二进制后缀）", file=out)
    for w, sug in terms:
        r = residues.get(w)
        if r:
            bad += len(r)
            tail = f"（应替换为：{sug}）" if sug else ""
            print(f"  ✗ {w}：无标记残留 {len(r)} 处{tail}", file=out)
            for p, i in r[:8]:
                print(f"      {p}:{i}", file=out)
            if len(r) > 8:
                print(f"      …另有 {len(r) - 8} 处", file=out)
        elif exempt.get(w):
            print(f"  ✓ {w}：残留 0（命中 {exempt[w]} 行，均为合法留痕）", file=out)
        else:
            zero.append(w)
    if zero:
        shown = ", ".join(zero[:10]) + ("…" if len(zero) > 10 else "")
        print(f"  ⚠ 词表零命中 {len(zero)} 词（{shown}）——疑似词表拼写漂移，请人工核对",
              file=out)
    print(f"[7] 合计：无标记残留 {bad} 处；零命中警告 {len(zero)} 词（警告不计发现数）",
          file=out)
    return bad


def self_test():
    """内置夹具自验（防安装环境差异）：枚举/标记/退出码/排除区/中文文件名。"""
    ok = True

    def ck(name, cond):
        nonlocal ok
        print(f"  {'✓' if cond else '✗'} {name}")
        ok = ok and cond

    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "docs"))
        os.makedirs(os.path.join(tmp, "sub"))
        os.makedirs(os.path.join(tmp, ".archive"))
        os.makedirs(os.path.join(tmp, ".tmp"))
        # 中文文件名 + 无标记残留 1 处（唯一应报的发现）
        with open(os.path.join(tmp, "docs", "验收环境.md"), "w", encoding="utf-8") as f:
            f.write("这里还有强制定稿残留\n")
        # 命中但整行带默认标记 → 豁免
        with open(os.path.join(tmp, "b.md"), "w", encoding="utf-8") as f:
            f.write("旧「强制定稿」已废除，历史引文\n")
        # 命中且整行带本词专属标记（词行 TAB 列）→ 同样豁免
        with open(os.path.join(tmp, "c.md"), "w", encoding="utf-8") as f:
            f.write("强制定稿 专属豁免样例\n")
        # 排除区三处残留：隐藏目录 / 隐藏目录 .tmp / *.pb.go —— 一处都不该扫出
        for rel in (os.path.join(".archive", "old.md"),
                    os.path.join(".tmp", "scratch.md"),
                    os.path.join("sub", "x.pb.go")):
            with open(os.path.join(tmp, rel), "w", encoding="utf-8") as f:
                f.write("强制定稿\n")
        # 不可解码文件 → 计读取跳过
        with open(os.path.join(tmp, "bin.md"), "wb") as f:
            f.write(b"\xff\xfe\x00bad")
        # 词表放排除区（.tmp/）——词表自身含全部词，留在活面会扫到自己
        terms_file = os.path.join(tmp, ".tmp", "terms.txt")
        with open(terms_file, "w", encoding="utf-8") as f:
            f.write("# 自验夹具\n")
            f.write("强制定稿 => 强制提交\t专属豁免\n")
            f.write("不存在词XYZ\n")
        terms, marks = parse_terms(terms_file)
        ck("词表解析（=> 映射 + TAB 专属标记 + 注释）",
           terms == [("强制定稿", "强制提交"), ("不存在词XYZ", None)] and "专属豁免" in marks)
        counts, residues, exempt = scan(terms, marks, [tmp])
        ck("残留=1 且落在中文文件名文件", len(residues.get("强制定稿", [])) == 1
           and residues["强制定稿"][0][0].endswith(os.path.join("docs", "验收环境.md")))
        ck("零命中词进警告面", "不存在词XYZ" not in residues and "不存在词XYZ" not in exempt)
        ck("豁免=2（默认标记行 + 专属标记行）", exempt.get("强制定稿") == 2)
        ck("排除区不扫出（.archive/.tmp/*.pb.go）", counts["excluded"] >= 3
           and all(not p.endswith(".pb.go") for p, _ in residues.get("强制定稿", [])))
        ck("不可解码计跳过且三计数对账", counts["undecodable"] == 1
           and counts["live"] == counts["read"] + counts["undecodable"] + counts["oversize"])
        summary = os.path.join(tmp, ".tmp", "summary.txt")
        with open(summary, "w", encoding="utf-8") as fh, \
                tempfile.TemporaryFile(mode="w+", encoding="utf-8") as buf:
            bad = run(terms, marks, [tmp], out=buf)
            buf.seek(0)
            text = buf.read()
            fh.write(str(bad))
        ck("发现数=1 与 summary-file 一致", bad == 1 and open(summary, encoding="utf-8").read() == "1")
        ck("报告含 ✗/⚠/三计数形状", "✗ 强制定稿" in text and "⚠ 词表零命中 1 词" in text
           and "排除区跳过" in text)
    print("self-test: " + ("✓ 全过" if ok else "✗ 有失败项"))
    return 0 if ok else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="词表驱动术语残留断言（只读）")
    ap.add_argument("--terms", help="词表文件（terms.txt）")
    ap.add_argument("--roots", default=None, help="扫描根，逗号分隔（缺省=当前目录全扫）")
    ap.add_argument("--summary-file", default=None, help="把发现数（单数字）写入该文件，供 plan-lint.sh 并账")
    ap.add_argument("--self-test", action="store_true", help="内置夹具自验，不需 --terms")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    if not args.terms:
        ap.error("--terms 必填（或用 --self-test）")
    roots = [r.strip() for r in (args.roots or ".").split(",") if r.strip()]
    try:
        terms, marks = parse_terms(args.terms)
        bad = run(terms, marks, roots)
    except UsageError as e:
        print(f"terms_check: ✗ {e}", file=sys.stderr)
        return 2
    if args.summary_file:
        with open(args.summary_file, "w", encoding="utf-8") as f:
            f.write(str(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

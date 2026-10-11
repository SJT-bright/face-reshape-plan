#!/usr/bin/env python3
"""从「个人积累库」(Life Pivot) 的 SQLite 库导出力量训练板块，
生成本应用「人生重塑计划 → 力量训练 → 导入历史数据」所需的单一合法 JSON。

用法（只读打开源库，绝不写入）：
    python3 scripts/export-strength-from-life-pivot.py "源库路径.sqlite" > 力量训练.json

导出后把整个 JSON 粘贴进导入框即可；导入端会整体校验，坏数据不会部分写入。
本脚本只执行下方内联的静态 SQL（无任何外部输入参与查询），
连接后立即开启 query_only 只读模式，任何写语句都会被 SQLite 拒绝。
"""
import json
import os
import re
import sqlite3
import sys
from urllib.request import pathname2url

MAX_TEXT = 4000


def cap(value, limit=MAX_TEXT):
    if value is None:
        return ""
    return str(value)[:limit]


def capn(value, limit=MAX_TEXT):
    return None if value is None else str(value)[:limit]


def parse_weight_kg(text):
    """旧库实际重量是自由文本（如 '40kg'、'40*2'）；取第一个 0~100000 的数字。"""
    if text is None:
        return None
    for match in re.findall(r"\d+(?:\.\d+)?", str(text)):
        number = float(match)
        if 0 < number <= 100000:
            return number
    return None


def main(argv):
    if len(argv) != 2:
        print("用法：export-strength-from-life-pivot.py <源库路径.sqlite>", file=sys.stderr)
        return 2
    db_path = argv[1]
    # 先确认源库存在：sqlite3.connect 普通模式会在路径不存在时静默创建空库，必须提前拒绝
    if not os.path.isfile(db_path):
        print(f"源库不存在：{db_path}（不会创建新的空库文件）", file=sys.stderr)
        return 2
    # 真只读打开：URI mode=ro 下 SQLite 不创建、不写入；pathname2url 负责路径的 URI 编码（空格/中文等）
    ro_uri = "file:" + pathname2url(os.path.abspath(db_path)) + "?mode=ro"
    conn = sqlite3.connect(ro_uri, uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma query_only = on")  # 双保险：只读模式下任何写语句都会被拒绝
    try:
        templates, cycle, days = [], {}, {}

        tpl_rows = conn.execute("select id, name, current_revision, created_at, updated_at from manual_exercise_templates order by updated_at desc").fetchall()
        ver_rows = conn.execute("select id, template_id, revision, effective_from, change_note, created_at from manual_exercise_template_versions order by revision").fetchall()
        day_rows = conn.execute("select id, template_version_id, day_key, name, body_part, is_rest, note, ordinal from manual_exercise_template_days order by ordinal").fetchall()
        act_rows = conn.execute("select id, template_day_id, action_key, name, planned_sets, planned_reps_text, planned_weight_text, target_text, note, ordinal from manual_exercise_template_actions order by ordinal").fetchall()
        cycle_rows = conn.execute("select template_id, current_day_key, revision, updated_at from manual_exercise_cycle_state").fetchall()
        train_rows = conn.execute("select id, business_date, template_version_id, day_key, day_name, is_rest, status, started_at, created_at, updated_at, coalesce(confirmed_duration_minutes, calculated_duration_minutes, manual_duration_minutes, 0) as minutes from manual_exercise_days order by business_date").fetchall()
        train_act_rows = conn.execute("select day_id, action_key, name, planned_sets, planned_reps_text, planned_weight_text, actual_sets, actual_reps_text, actual_weight_text, ordinal from manual_exercise_day_actions order by ordinal").fetchall()
        res_rows = conn.execute("select day_id, outcome, note, resolved_at from manual_exercise_day_resolutions where reopened_at is null").fetchall()

        cycle_by_tpl = {r["template_id"]: r for r in cycle_rows}
        ver_by_id = {r["id"]: r for r in ver_rows}
        actions_by_day = {}
        for a in train_act_rows:
            actions_by_day.setdefault(a["day_id"], []).append(a)
        res_by_day = {r["day_id"]: r for r in res_rows}
        days_by_version = {}
        for d in day_rows:
            days_by_version.setdefault(d["template_version_id"], []).append(d)
        actions_by_tday = {}
        for a in act_rows:
            actions_by_tday.setdefault(a["template_day_id"], []).append(a)

        for tpl in tpl_rows:
            versions = []
            for ver in [v for v in ver_rows if v["template_id"] == tpl["id"]]:
                tdays = []
                for d in days_by_version.get(ver["id"], []):
                    actions = [
                        {
                            "actionKey": cap(a["action_key"], 128),
                            "name": cap(a["name"], 200),
                            "plannedSets": int(a["planned_sets"] or 0),
                            "plannedRepsText": cap(a["planned_reps_text"]),
                            "plannedWeightText": cap(a["planned_weight_text"]),
                            "targetText": cap(a["target_text"], 1000),
                            "note": cap(a["note"]),
                            "ordinal": int(a["ordinal"] or 0),
                        }
                        for a in actions_by_tday.get(d["id"], [])
                    ]
                    tdays.append({
                        "dayKey": cap(d["day_key"], 128),
                        "name": cap(d["name"], 160),
                        "bodyPart": cap(d["body_part"], 160),
                        "isRest": bool(d["is_rest"]),
                        "note": cap(d["note"]),
                        "ordinal": int(d["ordinal"] or 0),
                        "actions": actions,
                    })
                versions.append({
                    "revision": int(ver["revision"] or 1),
                    "effectiveFrom": str(ver["effective_from"] or "")[:10],
                    "changeNote": cap(ver["change_note"], 1000),
                    "createdAt": cap(ver["created_at"], 40),
                    "days": tdays,
                })
            if not versions:
                continue
            templates.append({
                "id": cap(tpl["id"], 128),
                "name": cap(tpl["name"], 160),
                "currentRevision": int(tpl["current_revision"] or 1),
                "createdAt": cap(tpl["created_at"], 40),
                "updatedAt": cap(tpl["updated_at"], 40),
                "versions": versions,
            })
            state = cycle_by_tpl.get(tpl["id"])
            if state:
                cycle[templates[-1]["id"]] = {
                    "currentDayKey": cap(state["current_day_key"], 128),
                    "revision": int(state["revision"] or 1),
                    "updatedAt": cap(state["updated_at"], 40),
                }

        for row in train_rows:
            version = ver_by_id.get(row["template_version_id"])
            resolution_row = res_by_day.get(row["id"])
            days[str(row["business_date"])[:10]] = {
                "date": str(row["business_date"])[:10],
                "templateId": cap(version["template_id"], 128) if version else "",
                "templateRevision": int(version["revision"] or 1) if version else 1,
                "dayKey": cap(row["day_key"], 128),
                "name": cap(row["day_name"], 160),
                "bodyPart": "",
                "isRest": bool(row["is_rest"]),
                "status": cap(row["status"], 32) or "not-started",
                "totalSeconds": max(0, int(row["minutes"] or 0)) * 60,
                "startedAt": capn(row["started_at"], 40),
                "pausedAt": None,
                "revision": 1,
                "supplements": {"creatineTaken": None, "proteinPowderTaken": None, "note": ""},
                "confirmedDurationMinutes": None,
                "note": "",
                "completionText": "",
                "actions": [
                    {
                        "actionKey": cap(a["action_key"], 128),
                        "name": cap(a["name"], 200),
                        "plannedSets": int(a["planned_sets"] or 0),
                        "plannedRepsText": cap(a["planned_reps_text"]),
                        "plannedWeightText": cap(a["planned_weight_text"]),
                        "targetText": "",
                        "setsDone": None if a["actual_sets"] is None else max(0, int(a["actual_sets"])),
                        "repsText": cap(a["actual_reps_text"]),
                        "weightKg": parse_weight_kg(a["actual_weight_text"]),
                        "durationMinutes": None,
                        "note": "",
                    }
                    for a in actions_by_day.get(row["id"], [])
                ],
                "resolution": {
                    "outcome": cap(resolution_row["outcome"], 32) or "completed",
                    "note": cap(resolution_row["note"]),
                    "cycleAdvanced": True,
                    "resolvedAt": cap(resolution_row["resolved_at"], 40),
                } if resolution_row else None,
                "createdAt": cap(row["created_at"], 40),
            }

        payload = {"templates": templates, "cycle": cycle, "days": days, "events": [], "progress": []}
        json.dump(payload, sys.stdout, ensure_ascii=False, indent=1)
        sys.stdout.write("\n")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv))

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
collect_lite.py — px7a 采集器 (.65 常驻, 单文件 stdlib only)

数据源:
  1. .67 四 bot (bot2/nelson/neta/nina) — ssh vivam@192.168.178.67 → python - (stdin 脚本)
  2. .69 WSL2 nova/nyx — ssh -i hermes_migration hermes-bootstrap@192.168.178.69
                          → wsl -d Ubuntu-24.04 -u ming -- python3 (stdin 脚本)
  3. .65 本机 (default/natasha) — 本地 sqlite3 直读
  4. free_quota — 静态抄自 /tmp/snap_final2.json (本次不实现探针)

输出: /home/vivaming/work/fleet-dashboard/px7a-tools/var/status.json
用法:
  python3 collect_lite.py --once
  python3 collect_lite.py --loop 60
  python3 collect_lite.py --selftest

红线:
  - 零模型调用, 纯规则
  - 失败诚实标 error, 不编数
  - 不碰 .69 8081/8080

结局分类 (权威口径):
  - end_reason=NULL                            → skip (还在跑)
  - agent_close + api>0                        → normal
  - agent_close + api==0 + (dur<60s or msg<=1) → empty_shell (不进成功率分母)
  - agent_close + api==0 + (其他)              → normal (agent 跑了但没调 API)
  - 含 "reset"                                 → failed
  - 含 "sig" 或 "signal":
      host=ming-server(.65)                    → unknown (不进分母)
      其他 host                                → failed
  - 其他                                       → failed (兜底)

Buckets (en dash, 前端一致):
  4h, 4–24h, 24h–7d, older, unknown
  每段 normal, failed, timeout, unknown, empty_shell

成功率 = normal / (normal + failed + timeout); unknown 不进分母

P1-4 语义: 近 7 天 empty_shell>0 且 normal+failed+timeout==0
           → work 降级为「在线·空闲」, reasons=["仅空壳活动（任务启动即死，无有效结局）"]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

REPO_ROOT = "/home/vivaming/work/fleet-dashboard/px7a-tools"
OUT_PATH = os.path.join(REPO_ROOT, "var", "status.json")
FREE_QUOTA_SRC = "/tmp/snap_final2.json"  # 静态抄 free_quota 区

BUCKET_NAMES = ("4h", "4\u201324h", "24h\u20137d", "older", "unknown")
OUTCOME_KEYS = ("normal", "failed", "timeout", "unknown", "empty_shell")

BUCKET_BINS_S = ((4 * 3600, "4h"), (24 * 3600, "4\u201324h"),
                 (7 * 86400, "24h\u20137d"), (float("inf"), "older"))

# host 配置: id 稳定不变, short 前端用, transport 传输方式
HOSTS_CONFIG = (
    {"id": "ming-server", "short": ".65", "transport": "local",
     "user_host": None, "kind": "local"},
    {"id": "win-station", "short": ".67", "transport": "ssh",
     "user_host": "vivam@192.168.178.67", "kind": "win"},
    {"id": "ming-ai-station", "short": ".69", "transport": "ssh-wsl",
     "user_host": "hermes-bootstrap@192.168.178.69", "kind": "wsl"},
)

# 每 host 的 bot (profile, db path 模板)
# - local 直接路径
# - win 通过 ssh 跑 python 读 DB (Windows 原生 python)
# - wsl 通过 ssh → wsl → python3 读 DB
BOT_SOURCES = {
    "ming-server": [
        {"profile": "default", "db_path": "/home/vivaming/.hermes/state.db",
         "transport": "local"},
        {"profile": "natasha",
         "db_path": "/home/vivaming/.hermes/profiles/natasha/state.db",
         "transport": "local"},
    ],
    "win-station": [
        {"profile": "bot2", "transport": "win"},
        {"profile": "nelson", "transport": "win"},
        {"profile": "neta", "transport": "win"},
        {"profile": "nina", "transport": "win"},
    ],
    "ming-ai-station": [
        {"profile": "nova", "transport": "wsl"},
        {"profile": "nyx", "transport": "wsl"},
    ],
}

# 传输方式 → db path 模板 (传给远程 python 脚本)
WIN_DB_TPL = r"C:\Users\VIVAm\AppData\Local\hermes\profiles\{}\state.db"
WSL_DB_TPL = "/home/ming/.hermes/profiles/{}/state.db"

SSH_BASE_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
                 "-o", "BatchMode=yes"]
HERMES_KEY = os.path.expanduser("~/.ssh/hermes_migration")

# 内网 IP 掩码: 10./192.168./172.16-31. 后跟 : 或 /
IP_RE = re.compile(
    r"(?<![0-9.])((?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))"
    r"\.\d{1,3}\.\d{1,3})(?=[:/])"
)


def mask_ip(s):
    """内网 IP → x.x.x.x, 保留协议/端口/路径。"""
    if not isinstance(s, str) or not s:
        return s
    return IP_RE.sub("x.x.x.x", s)


# --------------------------------------------------------------------------
# Snapshot helpers
# --------------------------------------------------------------------------

def now_utc_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_free_quota():
    """从旧快照抄 free_quota 结构 (静态, 本次不探针)."""
    try:
        with open(FREE_QUOTA_SRC, "r", encoding="utf-8") as f:
            snap = json.load(f)
        fq = snap.get("free_quota")
        if isinstance(fq, dict):
            # 抄结构但标记为静态
            fq = dict(fq)
            fq["source_status"] = fq.get("source_status") or "static_copied"
            fq["collector_note"] = "static-copied from /tmp/snap_final2.json (probe not implemented in collect_lite)"
            return fq
    except Exception as e:
        return {"schema_version": 1, "generated_at": now_utc_iso(),
                "source_status": "error",
                "collector_note": "free_quota source unavailable: %s" % e,
                "channels": []}
    return {"schema_version": 1, "channels": []}


# --------------------------------------------------------------------------
# Remote execution
# --------------------------------------------------------------------------

# 远程 python 脚本模板: 读一个 profile 的 sessions + session_model_usage,
# 输出 "===JSON===" 后跟 JSON 对象。stdin 传入。
REMOTE_SCAN_SCRIPT = """
import sqlite3, json, time
profs = PROFS_JSON
path_tmpl = PATH_TML
now = time.time()
result = {}
for prof in profs:
    try:
        db = path_tmpl.format(prof)
        c = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
        cur = c.cursor()
        rows = cur.execute(
            "SELECT started_at, ended_at, end_reason, api_call_count, message_count "
            "FROM sessions WHERE parent_session_id IS NOT NULL"
        ).fetchall()
        usage = cur.execute(
            "SELECT model, billing_provider, billing_base_url, billing_mode, "
            "api_call_count, input_tokens, output_tokens, cache_read_tokens, "
            "cache_write_tokens, first_seen, last_seen "
            "FROM session_model_usage"
        ).fetchall()
        latest_any = cur.execute(
            "SELECT MAX(COALESCE(ended_at, started_at)) FROM sessions").fetchone()[0]
        result[prof] = {"sessions": rows, "usage": usage, "error": None,
                        "latest_any": latest_any}
        c.close()
    except Exception as e:
        result[prof] = {"error": repr(e)}
print("===JSON===")
print(json.dumps(result, default=str))
"""


def _run_remote(kind, profs, user_host, timeout=60):
    """kind: 'win' | 'wsl'. 通过 ssh 传 stdin python 脚本读远端 DB.
    返回 (dict profile→payload, error_str|None)."""
    if kind == "win":
        path_tmpl = WIN_DB_TPL
        cmd = ["ssh"] + SSH_BASE_OPTS + [user_host, "python -"]
    elif kind == "wsl":
        path_tmpl = WSL_DB_TPL
        cmd = (["ssh", "-i", HERMES_KEY] + SSH_BASE_OPTS + [user_host,
                     "wsl -d Ubuntu-24.04 -u ming -- python3"])
    else:
        return None, "unknown kind: %r" % kind

    script = (REMOTE_SCAN_SCRIPT
              .replace("PROFS_JSON", json.dumps(profs))
              .replace("PATH_TML", json.dumps(path_tmpl)))
    try:
        r = subprocess.run(cmd, input=script, capture_output=True,
                           text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, "timeout after %ds" % timeout
    except Exception as e:
        return None, "exec error: %r" % e

    stdout = r.stdout or ""
    idx = stdout.rfind("===JSON===")
    if idx < 0:
        tail = (r.stderr or "")[:400] + " || stdout: " + stdout[:200]
        return None, "no marker in output (rc=%d): %s" % (r.returncode, tail)
    try:
        return json.loads(stdout[idx + 11:].strip()), None
    except Exception as e:
        return None, "json parse error: %r" % e


def scan_local_bot(db_path):
    """本地 sqlite3 读 DB. 返回 payload dict 同远端格式."""
    try:
        c = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True)
        cur = c.cursor()
        rows = cur.execute(
            "SELECT started_at, ended_at, end_reason, api_call_count, message_count "
            "FROM sessions WHERE parent_session_id IS NOT NULL"
        ).fetchall()
        usage = cur.execute(
            "SELECT model, billing_provider, billing_base_url, billing_mode, "
            "api_call_count, input_tokens, output_tokens, cache_read_tokens, "
            "cache_write_tokens, first_seen, last_seen "
            "FROM session_model_usage"
        ).fetchall()
        latest_any = cur.execute(
            "SELECT MAX(COALESCE(ended_at, started_at)) FROM sessions").fetchone()[0]
        c.close()
        return {"sessions": rows, "usage": usage, "error": None,
                "latest_any": latest_any}
    except Exception as e:
        return {"error": repr(e)}


# --------------------------------------------------------------------------
# Classification & bucket building
# --------------------------------------------------------------------------

def classify_session(row, host_id):
    """row: (started_at, ended_at, end_reason, api_call_count, message_count).
    返回 (outcome, seg_key) 或 None (still running)."""
    started, ended, er, api, mc = row
    api = api or 0
    mc = mc or 0
    if er is None:
        return None
    er_low = str(er).lower()
    started = started or 0
    now = time.time()
    dur = (ended if ended is not None else now) - started

    if er_low == "agent_close":
        if api == 0 and (dur < 60 or mc <= 1):
            outcome = "empty_shell"
        else:
            outcome = "normal"
    elif "reset" in er_low:
        outcome = "failed"
    elif "signal" in er_low or er_low.startswith("sig") or "sig" in er_low:
        outcome = "unknown" if host_id == "ming-server" else "failed"
    elif "complete" in er_low or er_low in ("cli_close", "webhook_complete", "cron_complete"):
        outcome = "normal"  # 完成类收尾变体 (cron/webhook/cli 正常退出)
    else:
        outcome = "unknown"  # 未识别收尾 — 诚实不猜 (不冒充 failed)

    ref_ts = ended if ended is not None else now
    age = now - ref_ts
    seg = "unknown"
    for hi, name in BUCKET_BINS_S:
        if age <= hi:
            seg = name
            break
    return outcome, seg


def build_buckets(payload_sessions, host_id):
    """返回 (buckets_dict, summary_dict)."""
    buckets = {name: dict.fromkeys(OUTCOME_KEYS, 0) for name in BUCKET_NAMES}
    summary = {"total_sessions": len(payload_sessions), "open": 0,
               "classified": 0, "by_reason": {}}
    for row in payload_sessions:
        er = row[2]
        summary["by_reason"][er] = summary["by_reason"].get(er, 0) + 1
        res = classify_session(row, host_id)
        if res is None:
            summary["open"] += 1
            continue
        outcome, seg = res
        if seg in buckets and outcome in OUTCOME_KEYS:
            buckets[seg][outcome] += 1
            summary["classified"] += 1
    return buckets, summary


def build_tokens_totals(payload_usage):
    """聚合 session_model_usage 到 totals 列表 (按 model+provider+base_url+mode)."""
    agg = {}
    for row in payload_usage:
        model, prov, base, mode, calls, tin, tout, cr, cw, first, last = row
        key = (model or "", prov or "", mask_ip(base or ""), mode or "")
        entry = agg.setdefault(key, {
            "model": model or "",
            "provider": prov or "",
            "base_url": mask_ip(base or ""),
            "billing_mode": mode or "",
            "input": 0, "output": 0,
            "cache_read": 0, "cache_write": 0,
            "calls": 0,
            "first_seen": None, "last_seen": None,
        })
        entry["input"] += tin or 0
        entry["output"] += tout or 0
        entry["cache_read"] += cr or 0
        entry["cache_write"] += cw or 0
        entry["calls"] += calls or 0
        if first is not None:
            if entry["first_seen"] is None or first < entry["first_seen"]:
                entry["first_seen"] = float(first)
        if last is not None:
            if entry["last_seen"] is None or last > entry["last_seen"]:
                entry["last_seen"] = float(last)
    totals = sorted(agg.values(),
                    key=lambda e: -(e.get("input") + e.get("output")))
    return totals


def build_models_list(totals, now_ts):
    """从 totals 提炼出 models 列表 (去重 by model, 取最活跃的 base_url)."""
    seen = {}
    for t in totals:
        m = t["model"]
        if not m:
            continue
        if m not in seen or (t.get("last_seen") or 0) > (seen[m].get("last_seen") or 0):
            seen[m] = {
                "model": m,
                "provider": t.get("provider", ""),
                "base_url": t.get("base_url", ""),
                "last_seen": t.get("last_seen") or 0,
                "input": t.get("input", 0),
                "output": t.get("output", 0),
                "calls": t.get("calls", 0),
                "first_seen": t.get("first_seen") or 0,
                "estimated_cost_usd": 0.0,
                "cost_status": "unknown",
                "_score": 1,
                "label": t.get("provider") or "未知渠道",
                "free_status": "未知",
                "evidence": "无核验记录",
            }
    out = sorted(seen.values(), key=lambda m: -(m.get("last_seen") or 0))
    return out


# --------------------------------------------------------------------------
# Work state (含 P1-4)
# --------------------------------------------------------------------------

FRESH_WINDOW_S = 60 * 30  # 30 min 内有活动 → "工作中"
ACTIVE_WINDOW_S = 6 * 3600  # 6h 内有活动 → "近期有工作进展"


def compute_work(buckets, latest_activity_ts, now_ts):
    """根据 buckets 最近活动 + P1-4 语义判定 work 状态.
    P1-4: 近 7 天 (4h+4–24h+24h–7d) empty_shell>0 且 normal+failed+timeout==0
          → work 降级为「在线·空闲」, reasons=["仅空壳活动（任务启动即死，无有效结局）"]
    """
    # 近 7 天 = 4h + 4–24h + 24h–7d (不含 older/unknown)
    RECENT_KEYS = ("4h", "4\u201324h", "24h\u20137d")
    normal = sum(buckets[k]["normal"] for k in RECENT_KEYS if k in buckets)
    failed = sum(buckets[k]["failed"] for k in RECENT_KEYS if k in buckets)
    timeout = sum(buckets[k]["timeout"] for k in RECENT_KEYS if k in buckets)
    empty = sum(buckets[k]["empty_shell"] for k in RECENT_KEYS if k in buckets)

    reasons = []
    state = "在线·空闲"

    # P1-4 优先: 近 7 天仅空壳活动, 无有效结局
    if empty > 0 and (normal + failed + timeout) == 0:
        reasons.append("仅空壳活动（任务启动即死，无有效结局）")
        return {"state": "在线·空闲", "reasons": reasons,
                "progress_age_s": _age_s(latest_activity_ts, now_ts)}

    if latest_activity_ts is not None:
        age = now_ts - latest_activity_ts
        if age <= FRESH_WINDOW_S:
            state = "工作中"
            reasons.append("主会话最近活动 %ds 前" % int(age))
        elif age <= ACTIVE_WINDOW_S:
            state = "近期有工作进展"
            reasons.append("最近活动 %ds 前" % int(age))
        else:
            state = "在线·空闲"
            reasons.append("无待执行任务；最近活动 %ds 前" % int(age))
    else:
        reasons.append("无观测到活动")

    # 追加有效结局摘要
    if normal + failed + timeout > 0:
        reasons.append("近 7 天有效结局 normal=%d failed=%d timeout=%d empty_shell=%d"
                       % (normal, failed, timeout, empty))

    return {"state": state, "reasons": reasons,
            "progress_age_s": _age_s(latest_activity_ts, now_ts)}


def _age_s(ts, now_ts):
    if ts is None:
        return None
    return int(now_ts - ts)


# --------------------------------------------------------------------------
# Bot & host assembly
# --------------------------------------------------------------------------

def bot_id(host_id, profile):
    return "%s:%s" % (host_id, profile)


def assemble_bot(host, profile, payload, now_ts):
    """payload: {sessions, usage, error} 或 {error}.
    返回 (bot_dict, warnings_list)."""
    warnings = []
    b = {
        "id": bot_id(host["id"], profile),
        "host_id": host["id"],
        "short": host["short"],
        "profile": profile,
        "transport": host["transport"],
        "work": {"state": "error", "reasons": [], "progress_age_s": None},
        "tokens": {"totals": []},
        "models": [],
        "agents_completed_buckets": {n: dict.fromkeys(OUTCOME_KEYS, 0)
                                     for n in BUCKET_NAMES},
        "agents_completed_coverage": {
            "omp_ledger": "未接入",
            "xpi_seen": "未接入",
            "hermes_db": "unknown",
        },
        "agents_completed_count": 0,
        "agents_completed_count_basis": "hermes_db_child_sessions",
        "db_status": "ok",
    }

    if payload is None:
        b["work"] = {"state": "error",
                     "reasons": ["数据源不可用"],
                     "progress_age_s": None}
        b["db_status"] = "error"
        warnings.append("%s: source unavailable" % b["id"])
        return b, warnings

    if isinstance(payload, dict) and payload.get("error"):
        b["work"] = {"state": "error",
                     "reasons": ["数据库读取失败: %s" % payload["error"][:200]],
                     "progress_age_s": None}
        b["db_status"] = "error"
        warnings.append("%s: db read error: %s" % (b["id"], payload["error"][:150]))
        return b, warnings

    sessions = payload.get("sessions") or []
    usage = payload.get("usage") or []

    buckets, summary = build_buckets(sessions, host["id"])
    b["agents_completed_buckets"] = buckets
    b["agents_completed_count"] = summary["classified"]
    b["db_status"] = "ok"
    b["db_stats"] = {
        "child_sessions_total": summary["total_sessions"],
        "child_sessions_open": summary["open"],
        "child_sessions_classified": summary["classified"],
    }

    # coverage: hermes_db 若成功读到则 complete, 否则 unknown
    b["agents_completed_coverage"]["hermes_db"] = "complete"

    # tokens
    totals = build_tokens_totals(usage)
    b["tokens"] = {"totals": totals}

    # models
    b["models"] = build_models_list(totals, now_ts)

    # work state: 活动信号取全部会话 (含主会话/进行中); buckets 只统计委派任务
    latest = payload.get("latest_any") if isinstance(payload, dict) else None
    try:
        latest = float(latest) if latest else None
    except (TypeError, ValueError):
        latest = None
    if latest is None:
        for row in sessions:
            ts = row[1]  # ended_at
            if ts is None:
                ts = row[0]  # fallback to started_at (still open)
            if ts is None:
                continue
            ts = float(ts)
            if latest is None or ts > latest:
                latest = ts

    b["work"] = compute_work(buckets, latest, now_ts)

    return b, warnings


def scan_host(host, now_ts):
    """为一个 host 扫描所有 bot. 返回 (bots_list, warnings)."""
    bots = []
    warnings = []
    sources = BOT_SOURCES.get(host["id"], [])
    local_payloads = {}
    remote_payloads = {}

    # 本地 bot 单独处理
    for src in sources:
        if src["transport"] == "local":
            payload = scan_local_bot(src["db_path"])
            local_payloads[src["profile"]] = payload
        elif src["transport"] == "win":
            remote_payloads.setdefault("win", []).append(src["profile"])
        elif src["transport"] == "wsl":
            remote_payloads.setdefault("wsl", []).append(src["profile"])

    # 远端批量扫描 (每 host 一次 ssh, 减开销)
    for kind, profs in remote_payloads.items():
        if kind == "win" and host["kind"] != "win":
            continue
        if kind == "wsl" and host["kind"] != "wsl":
            continue
        data, err = _run_remote(kind, profs, host["user_host"])
        if err:
            for p in profs:
                b, w = assemble_bot(host, p, None, now_ts)
                b["work"]["reasons"] = ["远端 %s 采集失败: %s" % (kind, err[:150])]
                b["db_status"] = "error"
                bots.append(b)
                warnings.append("%s: remote %s failed: %s" % (b["id"], kind, err[:120]))
        else:
            for p in profs:
                payload = data.get(p, {"error": "profile not in response"})
                b, w = assemble_bot(host, p, payload, now_ts)
                bots.append(b)
                warnings.extend(w)

    # 本地 bot
    for src in sources:
        if src["transport"] != "local":
            continue
        p = src["profile"]
        b, w = assemble_bot(host, p, local_payloads.get(p), now_ts)
        bots.append(b)
        warnings.extend(w)

    return bots, warnings


def assemble_host(host, now_ts):
    bots, warnings = scan_host(host, now_ts)
    return {
        "host_id": host["id"],
        "short": host["short"],
        "transport": host["transport"],
        "observed_at": now_utc_iso(),
        "observed_at_epoch": now_ts,
        "last_success_at": now_utc_iso(),
        "error": None,
        "bots": bots,
    }, warnings


# --------------------------------------------------------------------------
# Snapshot & self_check
# --------------------------------------------------------------------------

def build_snapshot(cycle, warnings, hosts, fq, now_ts):
    snap_id = uuid.uuid4().hex[:12]
    return {
        "schema_version": 1,
        "snapshot_id": snap_id,
        "generated_at": now_utc_iso(),
        "collect_interval_s": 15,
        "web_refresh_hint_s": 5,
        "stale_after_s": 60,
        "unknown_after_s": 125,
        "collector": {
            "pid": os.getpid(),
            "cycle": cycle,
            "last_success_at": now_utc_iso(),
            "round_seconds": 0.0,
            "name": "collect_lite",
            "version": 1,
        },
        "hosts": hosts,
        "context_windows": {},  # lite: 未接入模型上下文窗口探测
        "free_quota": fq,
        "self_check": build_self_check(snap_id, warnings, hosts),
    }


def build_self_check(snapshot_id, warnings, hosts):
    errors = []
    bot_total = 0
    for h in hosts:
        for b in h.get("bots", []):
            bot_total += 1
            if b.get("work", {}).get("state") == "error":
                errors.append("%s: work=error" % b["id"])
    status = "ok" if not warnings and not errors else ("warn" if not errors else "error")
    return {
        "checked_at": now_utc_iso(),
        "snapshot_id": snapshot_id,
        "status": status,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "warnings": warnings,
        "issues": errors,
        "coverage": {
            "bots_total": bot_total,
        },
    }


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------

def write_snapshot(snapshot, path=OUT_PATH):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=2, default=str)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# --------------------------------------------------------------------------
# Main collect cycle
# --------------------------------------------------------------------------

def run_once(cycle, print_report=True):
    t0 = time.time()
    fq = load_free_quota()
    now_ts = time.time()
    all_hosts = []
    all_warnings = []
    for hcfg in HOSTS_CONFIG:
        host, warns = assemble_host(dict(hcfg), now_ts)
        all_hosts.append(host)
        all_warnings.extend(warns)
    snap = build_snapshot(cycle, all_warnings, all_hosts, fq, time.time())
    snap["collector"]["round_seconds"] = round(time.time() - t0, 3)
    write_snapshot(snap)
    if print_report:
        _print_report(snap)
    return snap


def _print_report(snap):
    n_hosts = len(snap["hosts"])
    n_bots = sum(len(h["bots"]) for h in snap["hosts"])
    n_warn = snap["self_check"]["warning_count"]
    n_err = snap["self_check"]["error_count"]
    print("[cycle %d] %s  hosts=%d bots=%d  warnings=%d errors=%d  round=%.2fs  → %s"
          % (snap["collector"]["cycle"], snap["generated_at"],
             n_hosts, n_bots, n_warn, n_err,
             snap["collector"]["round_seconds"], OUT_PATH))
    for h in snap["hosts"]:
        for b in h["bots"]:
            bk = b["agents_completed_buckets"]
            n = sum(bk[k]["normal"] for k in bk)
            f = sum(bk[k]["failed"] for k in bk)
            t = sum(bk[k]["timeout"] for k in bk)
            u = sum(bk[k]["unknown"] for k in bk)
            e = sum(bk[k]["empty_shell"] for k in bk)
            print("  %-30s  %-14s  n=%d f=%d t=%d u=%d es=%d  %s"
                  % (b["id"], b["work"]["state"], n, f, t, u, e,
                     "; ".join(b["work"]["reasons"][:2])))


# --------------------------------------------------------------------------
# Selftest
# --------------------------------------------------------------------------

def _success_rate(buckets):
    n = sum(b["normal"] for b in buckets.values())
    f = sum(b["failed"] for b in buckets.values())
    t = sum(b["timeout"] for b in buckets.values())
    denom = n + f + t
    if denom == 0:
        return "-"
    return round(100.0 * n / denom, 2)


def _selftest_selftest(mock_bot):
    """测试 P1-4: 只 empty_shell 的 mock bot → work=空闲"""
    buckets = {n: dict.fromkeys(OUTCOME_KEYS, 0) for n in BUCKET_NAMES}
    buckets["24h\u20137d"]["empty_shell"] = 3
    buckets["4\u201324h"]["empty_shell"] = 1
    now_ts = time.time()
    work = compute_work(buckets, latest_activity_ts=now_ts - 300, now_ts=now_ts)
    assert work["state"] == "在线·空闲", \
        "P1-4 fail: state=%r (expect 在线·空闲)" % work["state"]
    assert "仅空壳活动" in work["reasons"][0], \
        "P1-4 fail: reasons=%r" % work["reasons"]
    return work


def _selftest_empty_bot_downgrade():
    """独立 mock bot: 只 empty_shell, 验证降级."""
    buckets = {n: dict.fromkeys(OUTCOME_KEYS, 0) for n in BUCKET_NAMES}
    buckets["4\u201324h"]["empty_shell"] = 5
    now_ts = time.time()
    work = compute_work(buckets, latest_activity_ts=now_ts - 10, now_ts=now_ts)
    if work["state"] != "在线·空闲":
        return False, "state=%r" % work["state"]
    if not any("空壳" in r for r in work["reasons"]):
        return False, "reasons=%r" % work["reasons"]
    return True, "ok: state=%r reasons=%r" % (work["state"], work["reasons"])


def run_selftest():
    print("== SELFTEST START ==")
    fails = []

    # 1) 跑一轮 --once
    print("[1/5] running one collect cycle ...")
    try:
        snap = run_once(cycle=-1, print_report=False)
    except Exception as e:
        print("SELFTEST_FAIL: run_once raised: %r" % e)
        return 1

    # 2) nova buckets 有数据 & 成功率合法
    print("[2/5] checking nova buckets + success rate ...")
    nova = None
    for h in snap["hosts"]:
        for b in h["bots"]:
            if b["id"].endswith(":nova"):
                nova = b
                break
    if nova is None:
        fails.append("nova bot not found in snapshot")
    else:
        bk = nova["agents_completed_buckets"]
        if not isinstance(bk, dict) or not set(bk.keys()) == set(BUCKET_NAMES):
            fails.append("nova buckets shape: %r" % (list(bk.keys()) if isinstance(bk, dict) else type(bk)))
        else:
            for k, v in bk.items():
                if not set(v.keys()) == set(OUTCOME_KEYS):
                    fails.append("nova bucket %s keys: %r" % (k, list(v.keys())))
                    break
        rate = _success_rate(nova["agents_completed_buckets"])
        if rate != "-":
            if not (0 <= float(rate) <= 100):
                fails.append("nova success_rate out of range: %r" % rate)
        print("       nova buckets=%r  rate=%s" % (
            nova["agents_completed_buckets"], rate))

    # 3) .67 至少 1 bot 有 buckets
    print("[3/5] checking .67 bots have buckets ...")
    win_bots = []
    for h in snap["hosts"]:
        if h["short"] == ".67":
            win_bots = h["bots"]
            break
    if not win_bots:
        fails.append(".67 has no bots")
    else:
        n_with_buckets = 0
        for b in win_bots:
            bk = b.get("agents_completed_buckets", {})
            if isinstance(bk, dict) and any(
                sum(v.values()) > 0 for v in bk.values() if isinstance(v, dict)
            ):
                n_with_buckets += 1
        if n_with_buckets == 0:
            fails.append(".67 has 0 bots with nonzero buckets (all-zero is a valid observation, "
                         "but 0/4 suspicious)")
        print("       .67 bots=%d with_nonzero_buckets=%d" % (len(win_bots), n_with_buckets))

    # 4) 快照 JSON 无内网 IP 明文
    print("[4/5] checking no internal IP leaks in JSON output ...")
    try:
        with open(OUT_PATH, "r", encoding="utf-8") as f:
            raw = f.read()
    except Exception as e:
        fails.append("cannot read %s: %r" % (OUT_PATH, e))
        raw = ""
    if raw:
        # 找 192.168./10./172.16-31. 后跟 : 或 / (应被掩码)
        leaks = IP_RE.findall(raw)
        if leaks:
            fails.append("internal IP leaked: %r (first 5: %s)" %
                         (leaks, leaks[:5]))
        print("       IP leak check: %d hits (expect 0)" % len(leaks))
        # 验证掩码存在
        if "x.x.x.x" in raw:
            print("       x.x.x.x mask present (good)")
    else:
        fails.append("empty JSON output")

    # 5) 空壳降级
    print("[5/5] checking empty-shell downgrade (mock bot) ...")
    ok, msg = _selftest_empty_bot_downgrade()
    if not ok:
        fails.append("empty-shell downgrade: %s" % msg)
    else:
        print("       mock: %s" % msg)

    print("== SELFTEST END ==")
    if fails:
        print("SELFTEST_FAIL: %d issue(s)" % len(fails))
        for f in fails:
            print("  - %s" % f)
        return 1
    print("SELfTEST_DONE")
    return 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(description="px7a collect_lite")
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--once", action="store_true", help="跑一轮")
    grp.add_argument("--loop", type=int, metavar="N",
                     help="循环 N 秒")
    grp.add_argument("--selftest", action="store_true", help="单测")
    ap.add_argument("--cycle-start", type=int, default=1,
                    help="起始 cycle 号 (loop 用)")
    args = ap.parse_args(argv)

    if args.selftest:
        return run_selftest()

    if args.once:
        run_once(cycle=args.cycle_start)
        return 0

    if args.loop is not None:
        if args.loop <= 0:
            print("loop interval must be > 0", file=sys.stderr)
            return 2
        cycle = args.cycle_start
        while True:
            try:
                run_once(cycle=cycle)
            except Exception as e:
                print("[loop] cycle %d failed: %r" % (cycle, e), file=sys.stderr)
            cycle += 1
            time.sleep(args.loop)


if __name__ == "__main__":
    try:
        rc = main()
        sys.exit(rc or 0)
    except KeyboardInterrupt:
        sys.exit(130)

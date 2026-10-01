// 免费额度 bar 渲染（docs/free-quota-design.md §7）。只读入参，无网络，textContent。
window.FleetFreeQuota = Object.freeze({ render, capacityWidth, usageColor });

function capacityWidth(capacityUnits, scaleMaxUnits = 4) {
  if (capacityUnits == null || Number.isNaN(capacityUnits) || capacityUnits < 0) return null;
  return Math.min(capacityUnits / scaleMaxUnits, 1) * 100;
}
function usageColor(usedRatio) {
  const stops = [[0, [34, 197, 94]], [0.5, [234, 179, 8]], [0.8, [249, 115, 22]], [1, [239, 68, 68]]];
  if (usedRatio == null || Number.isNaN(usedRatio) || usedRatio < 0 || usedRatio > 1) return "#64748b";
  const p = usedRatio;
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
      const t = (p - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + t * (c1[k] - v)));
      return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
    }
  }
  return "#ef4444";
}
function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "未知";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(Math.round(n));
}
function render(container, freeQuota, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const snapFresh = options.snapshotFreshness !== false;
  container.textContent = "";
  const h = document.createElement("div");
  h.className = "free-quota-head";
  h.textContent = "免费额度 · 长度=单账号参考容量的倍数 · 颜色=已用比例（不同渠道不等价）";
  container.appendChild(h);
  const chs = (freeQuota && freeQuota.channels) || [];
  if (!chs.length) {
    const d = document.createElement("div");
    d.className = "fq-row";
    d.textContent = "免费额度尚无观测";
    container.appendChild(d);
    return;
  }
  for (const c of chs) {
    // 紧凑单行：名称×N · 总量/参考 · 状态文字 · 行尾 60px 细条
    const row = document.createElement("div");
    row.className = "fq-row";
    const xN = c.account_count > 0 ? `×${c.account_count}` : "";
    const limitTxt = c.id === "groq" ? `${c.model || "探测模型"} 的 RPD ${fmtNum(c.limit)}` : (c.limit != null) ? `总量${fmtNum(c.limit)}${unitTxt(c)}` :
      ((c.reference_limit != null && c.account_count)
        ? `参考${fmtNum(c.reference_limit)}${unitTxt(c)}`
        : "总量未知");
    const track = document.createElement("div");
    track.className = "fq-track";
    const fill = document.createElement("div");
    fill.className = "fq-fill";
    const w = capacityWidth(c.visual && c.visual.capacity_units, (c.visual && c.visual.scale_max_units) || 4);
    const unknown = c.used_ratio == null || !snapFresh || c.usage_quality !== "exact";
    fill.style.width = (w == null ? 100 : w) + "%";
    fill.style.background = unknown ? "repeating-linear-gradient(45deg,#f59e0b55 0 5px,#f59e0b99 5px 10px)" : usageColor(c.used_ratio);
    if (w == null) fill.style.borderRight = "2px dashed #64748b";
    track.appendChild(fill);
    let txt;
    if (!snapFresh) txt = "全站数据过期·比例降级";
    else if (c.used_ratio != null) txt = `已用${(c.used_ratio * 100).toFixed(1)}% 剩${fmtNum(c.remaining)}`;
    else if (c.known_subtotal) txt = `已知${c.known_subtotal.account_count}/${c.account_count}账号小计`;
    else {
      const av = (c.state_counts || {}).available || 0;
      const th = ((c.state_counts || {}).throttled || 0) + ((c.state_counts || {}).suspected_exhausted || 0);
      txt = "已用未知";
      if (c.account_count > 1 && (av || th)) txt = `可用${av}/${c.account_count}` + (th ? ` 受限${th}` : "");
    }
    if (unknown && !txt.includes("已用未知")) txt = "已用未知 · " + txt;
    if (c.partial_accounts) txt += " · 部分账号";
    row.title = (c.reason_codes || ["unverified"]).join(" · ") +
      (c.probe_model_quota ? " · reset=" + c.probe_model_quota.reset + " · sampled_at=" + c.probe_model_quota.sampled_at : "");
    for (const rate of c.rate_windows || []) txt += ` · TPM ${fmtNum(rate.remaining)}/${fmtNum(rate.limit)}`;
    const calls = c.local_calls_24h || [];
    if (calls.length) {
      const known = calls.filter(r => r.count != null);
      const n = known.reduce((a,r) => a + r.count, 0);
      txt += ` · 近24h 本机记录 ${known.length ? n : "未知"} 次（含重试/失败/探针）`;
      if (known.length < 2 || known.some(r => r.partial)) txt += " · 覆盖不全";
      row.title += " · 调用台账 .69+.65；.67 二期。仅含已记录调用，未落盘重试不可见。 " + calls.map(r => `${r.host}: ${r.count ?? "未接入"}`).join(" / ");
    }
    row.appendChild(Object.assign(document.createElement("b"), { textContent: (c.label || c.id) + (xN ? " " + xN : "") }));
    row.appendChild(Object.assign(document.createElement("span"), { className: "fq-limit", textContent: limitTxt }));
    row.appendChild(track);
    row.appendChild(Object.assign(document.createElement("span"), { className: "fq-nums", textContent: txt }));
    container.appendChild(row);
  }
}
function unitTxt(c) {
  if (c.unit === "neurons") return " neurons/日";
  if (c.scope === "ip_rate_limited") return " (按IP限速)";
  if (c.window?.kind === "rolling" && c.window.seconds) return ` 次/${c.window.seconds / 3600}h（参考）`;
  return " 次/日";
}
function refOf(c) {
  return (c.account_count && c.visual && c.visual.capacity_units)
    ? Math.round((c.limit || 0) / c.account_count) || null : null;
}

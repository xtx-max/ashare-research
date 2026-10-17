"use strict";
(() => {
  let saved = null;
  let pending = null;
  const percent = v => typeof v === "number" ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%` : "未知";
  const drawdown = v => typeof v === "number" ? `${(v * 100).toFixed(2)}%` : "未知";
  const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
  async function load() {
    if (saved) return saved;
    if (!pending) pending = fetch(window.hostedMarket ? "./seasonality.json" : "/api/seasonality", {cache: "no-store"}).then(r => { if (!r.ok) throw new Error("read_failed"); return r.json(); }).then(r => { if (!r.study?.statistics?.cells) throw new Error("empty"); saved = r; return r; }).finally(() => { pending = null; });
    return pending;
  }
  function addMetric(dl, name, value) { const group = node("div"); group.append(node("dt", name), node("dd", value)); dl.append(group); }
  function table(headers, rows) {
    const wrap = node("div", undefined, "seasonal-comparison-scroll"); const t = node("table", undefined, "seasonal-comparison");
    const head = node("thead"), tr = node("tr"); headers.forEach(x => { const th = node("th", x); th.scope = "col"; tr.append(th); }); head.append(tr); t.append(head);
    const body = node("tbody"); rows.forEach(row => { const tr = node("tr"); row.forEach(x => tr.append(node("td", x))); body.append(tr); }); t.append(body); wrap.append(t); return wrap;
  }
  function windowName(c) {
    const k = c.window.key; if (c.window.kind === "MONTH") return `${c.window.month}月`;
    const names = {SPRING:"春季", SUMMER:"夏季", AUTUMN:"秋季", WINTER:"跨年冬季", BUSINESS_SEASON:"业务旺季", AFTER_SEASON:"旺季后20交易日"};
    return names[k] || k.replace("ACTIVITY_LEAD", "旺季前").replace("CNY_LEAD", "春节前") + "交易日";
  }
  async function show(id) {
    const panel = document.getElementById("seasonal-distribution"); if (!panel) return;
    panel.replaceChildren(node("p", "正在读取已保存年度分布…", "seasonal-loading")); panel.setAttribute("aria-busy", "true");
    try {
      const payload = await load(); const c = payload.study.statistics.cells.find(c => c.test_id === id); if (!c) throw new Error("missing");
      panel.replaceChildren(node("h4", `${c.theme_name} · ${windowName(c)}`));
      const dl = node("dl");
      addMetric(dl,"独立年度",`${c.independent_years}年`); addMetric(dl,"平均超额",percent(c.mean_excess)); addMetric(dl,"中位超额",percent(c.median_excess)); addMetric(dl,"正超额年度",c.independent_years ? `${c.positive_excess_count}/${c.independent_years}` : "未知（0年）");
      addMetric(dl,"平均价格收益",percent(c.mean_return)); addMetric(dl,"最大持有回撤",drawdown(c.max_holding_drawdown)); addMetric(dl,"95%年块区间",c.mean_excess_ci95 ? c.mean_excess_ci95.map(percent).join(" 至 ") : "样本不足"); addMetric(dl,"未校正p",typeof c.p_raw === "number" ? c.p_raw.toFixed(4) : "未检验"); addMetric(dl,"BY校正后q",typeof c.q_by === "number" ? c.q_by.toFixed(4) : "未检验");
      addMetric(dl,"正收益年度",c.independent_years ? `${c.positive_return_count}/${c.independent_years}` : "未知（0年）"); addMetric(dl,"超额10% / 90%分位",c.quantiles_excess ? `${percent(c.quantiles_excess["0.1"])} / ${percent(c.quantiles_excess["0.9"])}` : "未知"); addMetric(dl,"最差年度超额",c.worst_year ? `${c.worst_year.season_year}年 · ${percent(c.worst_year.excess)}` : "未知");
      panel.append(dl, node("p", `基准：沪深300价格指数；${c.index_code ? "行业指数价格历史重建" : "缺历史主题指数/成员，仅当前业务观察"}。完整检验集合${c.family_size}格；${c.multiple_test_pass ? "校正支持，仍需独立前向" : "无校正后支持"}。`, "seasonal-method-note"));
      if (c.samples.length) panel.append(table(["年度/季节年", "起止交易日", "价格收益", "基准", "超额", "持有回撤"],c.samples.map(s => [String(s.season_year),`${s.start} — ${s.end}`,percent(s.return),percent(s.benchmark_return),percent(s.excess),drawdown(s.max_drawdown)])));
      else panel.append(node("p","尚无可核实的独立年度样本。未知保持未知，未用今日成员回填过去。","seasonal-notice"));
      const diag = c.diagnostics?.without_largest_absolute_year;
      if (diag && c.samples.length) panel.append(node("p",`诊断：最大绝对贡献年度 ${c.largest_absolute_contribution_year || "未知"}；仅诊断去除该年度后均值 ${percent(diag.mean_excess)}。主结果保留所有年份；2020疫情与2022冬奥会另列一次性事件诊断。`,"seasonal-method-note"));
      const eventDiag = c.diagnostics?.without_registered_2020_2022_events;
      if (eventDiag && c.samples.length) panel.append(node("p",`去除预登记异常事件年度的诊断均值：${percent(eventDiag.mean_excess)}，剩余${eventDiag.independent_years}年。不能用诊断替换主结果。`,"seasonal-method-note"));
      panel.append(node("p",`缺口：${c.missing.length}个年份/窗口未纳入，包含未完整年度、跨年未成熟或缺交易日。`,"seasonal-method-note"));
      document.querySelectorAll("[data-seasonal-cell]").forEach(e => e.setAttribute("aria-pressed",String(e.dataset.seasonalCell === id)));
    } catch (_) {
      const retry = node("button","重试读取"); retry.type="button"; retry.addEventListener("click",()=>show(id),{once:true});
      panel.replaceChildren(node("p","年度分布暂时读取失败。已保存的主分析仍可阅读；重试只读取本地记录，不重新抓取行情。","seasonal-error"), retry);
    } finally { panel.removeAttribute("aria-busy"); }
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-seasonal-cell]"); if (b) show(b.dataset.seasonalCell); });
  document.addEventListener("change", e => { if (e.target.id === "seasonal-window-selector" && e.target.value) { show(e.target.value); document.getElementById("seasonal-distribution")?.scrollIntoView({block:"nearest", behavior:"auto"}); } });
})();

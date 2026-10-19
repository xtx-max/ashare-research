"use strict";

(() => {
  const root = document.getElementById("personal-finance");
  if (!root || !window.personalFinance) return;
  const F = window.personalFinance, KEY = "tianxing:personal-finance:v1", MAX_BYTES = 5_000_000;
  const names = {deposit: "银行存款", cash: "现金管理", bond: "债券类", ashare_etf: "A股指数ETF", ashare_stock: "A股股票"};
  const eventNames = {profile: "财务规划", goal: "目标测算", retirement: "退休测算", product: "产品笔记", valuation: "试投估值", learning: "学习进度", cashflow: "实际收支", review: "复盘"};
  const money = v => Number.isFinite(v) ? v.toLocaleString("zh-CN", {minimumFractionDigits: 0, maximumFractionDigits: 2}) + " 元" : "尚未知";
  const percent = v => Number.isFinite(v) ? (v * 100).toFixed(2) + "%" : "尚未知";
  const el = (tag, value, className) => { const n = document.createElement(tag); if (value !== undefined) n.textContent = value; if (className) n.className = className; return n; };
  const byId = id => document.getElementById(id);
  const uid = () => crypto.randomUUID();
  const bytes = value => new TextEncoder().encode(value).byteLength;
  let events = [], persistent = true, originalRaw = null, storageRead = false;
  function unpack(raw) {
    if (!raw) return [];
    if (bytes(raw) > MAX_BYTES) throw new Error("备份超过5MB");
    const data = JSON.parse(raw);
    if (!data || data.version !== F.VERSION || !Array.isArray(data.events)) throw new Error("不是兼容的个人理财备份");
    return F.merge([], data.events);
  }
  try { originalRaw = localStorage.getItem(KEY); storageRead = true; events = unpack(originalRaw); }
  catch (error) {
    persistent = false;
    byId("wealth-export-original").hidden = !storageRead;
    byId("wealth-storage-status").textContent = storageRead ? "原本机记录未能通过校验，已保留原内容；当前为临时模式，不覆盖原档。可单独导出异常原档排查；本次新记录也能单独导出。" : "浏览器存储不可用。本次仅在内存中计算，刷新可能丢失；请导出备份。";
  }
  const pack = entries => JSON.stringify({version: F.VERSION, events: entries});
  function commit(next) {
    const raw = pack(next);
    if (bytes(raw) > MAX_BYTES) throw new Error("记录超过5MB，请先导出备份");
    if (persistent) {
      try { localStorage.setItem(KEY, raw); }
      catch { persistent = false; byId("wealth-storage-status").textContent = "浏览器没有保存成功，本次仅暂存在内存。请立即导出；刷新后可能丢失。"; }
    }
    events = next;
    render();
    return persistent;
  }
  function append(type, payload) {
    let existing = events;
    if (persistent) existing = F.merge(events, unpack(localStorage.getItem(KEY)));
    return commit(F.merge(existing, [{id: uid(), at: new Date().toISOString(), type, payload}]));
  }
  function message(form, value, failed = false) {
    const status = form.querySelector(".wealth-receipt");
    status.textContent = value; status.classList.toggle("is-error", failed);
  }
  function values(form, nullable = []) {
    const p = {};
    for (const [key, value] of new FormData(form)) {
      const input = form.elements.namedItem(key);
      p[key] = input.type === "number" ? value === "" && nullable.includes(key) ? null : Number(value) : value;
    }
    return p;
  }
  function fill(form, p) {
    if (!p) return;
    for (const [key, value] of Object.entries(p)) {
      const input = form.elements.namedItem(key);
      if (input && "value" in input) input.value = value === null ? "" : value;
    }
  }
  function bind(id, type, read = form => values(form)) {
    const form = byId(id);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      try {
        const saved = append(type, read(form));
        message(form, saved ? "已追加保存到当前浏览器。个人资料没有上传。" : "已计算，本次仅暂存在内存，请导出备份。没有上传资料。");
      } catch (error) { message(form, error.message || "校验失败，旧记录保持原样。", true); }
    });
  }
  function table(headings, rows, caption) {
    const wrapper = el("div", undefined, "wealth-table-wrap");
    const t = el("table", undefined, "wealth-table"); t.setAttribute("aria-label", caption);
    const head = el("thead"), tr = el("tr"), body = el("tbody");
    for (const h of headings) { const th = el("th", h); th.scope = "col"; tr.append(th); }
    head.append(tr);
    for (const row of rows) {
      const r = el("tr"); row.forEach((value, i) => { const td = el("td", value); td.dataset.label = headings[i]; r.append(td); }); body.append(r);
    }
    t.append(head, body); wrapper.append(t); return wrapper;
  }
  function metric(title, value, note) {
    const n = el("div"); n.append(el("span", title), el("strong", value), el("small", note)); return n;
  }
  function renderBudget(s) {
    if (!s.profile) return;
    const p = s.profile, b = F.budget(p), summary = byId("wealth-summary");
    const lead = el("div"), steps = el("ol");
    lead.append(el("span", "当前优先事项", "wealth-kicker"), el("h3", b.priority), el("p", b.detail));
    const actions = ["本月先补应急金 " + money(b.reserveContribution), "可额外复核还款 " + money(b.debtContribution), "本月长期规划上限 " + money(b.planMonthly)];
    actions.forEach(a => steps.append(el("li", a)));
    summary.replaceChildren(lead, steps);
    const metrics = byId("wealth-metrics"); metrics.hidden = false;
    metrics.replaceChildren(metric("每月结余", money(b.surplus), "收入 − 生活开支 − 还款"), metric("应急金缺口", money(b.reserveGap), "目标 " + money(b.reserveTarget) + " / " + p.reserveMonths + "个月"), metric("可另作长期规划现金", money(b.planCapital), "扣除应急目标与近期用途；不含现有投资"), metric("自报净资产", money(b.netAssets), "现金 + 投资市值 − 负债，未验证估值"));
    root.querySelector('[data-open-finance="finance-setup"]').textContent = "更新我的计划";
    const risk = byId("wealth-risk-reading");
    risk.replaceChildren(el("h3", "先看承受力，再看收益"), el("p", "若现有投资市值下跌30%，账面损失约 " + money(b.stressLoss) + "。这是压力情景，不是最大损失预测；你填写的可接受阶段亏损为 " + p.lossTolerance + "%。"));
    risk.append(el("p", p.incomeType === "variable" && p.reserveMonths < 6 ? "收入不稳定时，建议再比较6—12个月的安全垫，当前仍按你选择的月数计算。" : "应急资金优先考虑可取用性与本金风险，股票和锁定产品不计入可随取现金。"));
    risk.append(el("p", p.lossTolerance === 0 || p.horizon < 3 ? "这笔钱的期限或亏损承受条件不适合承担A股价格波动。下方行情可学习观察，不据此安排买入。" : "可先研究少量透明的长期工具；这不是机构适当性评级，也不自动生成配置比例或放大原A股资金池。"));
    if (p.earmarked > p.cash) risk.append(el("p", "近期用途超过当前可取现金，尚有资金缺口；已将可用应急现金按0计算。", "wealth-warning"));
  }
  function affordability(node, required, principal, s) {
    if (!s.profile) { node.append(el("p", "保存收支计划后，可对比月投入是否超出闲钱范围。")); return; }
    const b = F.budget(s.profile);
    node.append(el("p", required > b.planMonthly ? "中间情景每月所需比当前可规划上限多 " + money(required - b.planMonthly) + "。先比较延长期限、调整目标或增加结余，不能用提高收益假设代替补足资金。" : "中间情景的月投入在当前预算上限内，仍需考虑收入变化、亏损和多目标占用。"));
    if (principal > b.planCapital) node.append(el("p", "填入的目标本金超过当前可另作长期规划的现金。若来自现有投资或专用目标账户，请确认没有挪用应急金或重复占用其他目标。", "wealth-warning"));
  }
  function renderGoal(s) {
    if (!s.goal) return;
    const p = s.goal, g = F.goal(p), node = byId("wealth-goal-result");
    node.replaceChildren(el("h3", p.years + "年后的目标，需要怎样的投入？"), el("p", "今天的 " + money(p.target) + "，按通胀假设折合届时 " + money(g.targetFuture) + "。"));
    node.append(table(["演算情景", "期末购买力 · 今天的元", "每月所需"], g.scenarios.map((r, i) => [["较低", "中间", "较高"][i] + " " + r.annualReturn + "%", money(r.realValue), money(r.required)]), "目标情景对照"));
    const mid = g.scenarios[1];
    node.append(el("p", "计划累计投入 " + money(mid.paid) + "；中间情景期末名义金额 " + money(mid.value) + "，费用后名义年增长假设 " + percent(mid.annualNet) + "。没有计入未填写的税费。"));
    node.append(el("p", mid.realValue < p.target ? "按当前每月 " + money(p.monthly) + "，中间情景距目标仍差今天的 " + money(p.target - mid.realValue) + "。若沿用这些假设，每月需比当前增加 " + money(Math.max(0, mid.required - p.monthly)) + "；也可延长期限或降低目标。" : "按当前每月 " + money(p.monthly) + "，中间情景演算可覆盖目标；仍需预留实际亏损、收入变化和未计费用的余量。"));
    affordability(node, mid.required, p.principal, s);
    const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chart.setAttribute("viewBox", "0 0 480 190"); chart.setAttribute("role", "img"); chart.setAttribute("aria-label", "三个假设情景的购买力轨迹，非收益预测区间"); chart.classList.add("wealth-trajectory");
    const max = Math.max(...g.trajectory.flatMap(r => [r.s0, r.s1, r.s2, r.paid]), p.target, 1);
    for (const [i, key] of ["s0", "s1", "s2"].entries()) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      path.setAttribute("points", g.trajectory.map(r => (20 + r.year / p.years * 440) + "," + (170 - r[key] / max * 150)).join(" "));
      path.setAttribute("class", "scenario-" + i); chart.append(path);
    }
    node.append(chart, el("small", "横轴：年；纵轴：今天的购买力。三条线是假设路径，不是置信区间；实际收益可能低于全部情景。"));
    const details = el("details", undefined, "wealth-inner"); details.append(el("summary", "查看逐年数字"), table(["年", "累计投入", "较低购买力", "中间购买力", "较高购买力"], g.trajectory.map(r => [String(r.year), money(r.paid), money(r.s0), money(r.s1), money(r.s2)]), "目标逐年轨迹")); node.append(details);
  }
  function renderRetirement(s) {
    if (!s.retirement) return;
    const p = s.retirement, r = F.retirement(p), node = byId("wealth-retirement-result");
    const stressed = F.retirement({...p, postReturn: Math.max(-20, p.postReturn - 2), inflation: Math.min(15, p.inflation + 1)});
    node.replaceChildren(el("h3", "按生活缺口估计退休准备"), metric("退休时所需名义资金", money(r.retirementNeed), "对应今天购买力 " + money(r.todayNeed)), metric("退休前每月所需投入", money(r.required), "距退休 " + r.years + "年，退休支出规划 " + r.retirementMonths / 12 + "年"));
    node.append(el("p", "退休后费用与通胀调整后的实际年增长假设为 " + percent(r.realPostAnnual) + "。按月初取用、缺口购买力不变计算，不以当前收入的固定比例替代生活开支。"));
    node.append(el("p", "按当前每月投入 " + money(p.monthly) + "，退休时的名义资金演算为 " + money(r.projected) + "；" + (r.projected < r.retirementNeed ? "比该情景需求少 " + money(r.retirementNeed - r.projected) + "，可比较延后退休、调整开销或增加结余。" : "在该固定收益情景下覆盖需求，仍需考虑下述压力情景。")));
    node.append(el("p", "压力情景：退休后名义年收益降低2个百分点、通胀提高1个百分点，退休前每月所需约 " + money(stressed.required) + "。收益顺序、长寿及突发大额支出未由固定收益公式覆盖，目标不能视为保证。"));
    affordability(node, r.required, p.principal, s);
    node.append(el("p", "目标与退休工具是独立测算，请勿将两处的可用本金、月结余重复分配。"));
  }
  function renderProducts(s) {
    const filter = byId("wealth-product-filter").value, sort = byId("wealth-product-sort").value;
    const products = Object.values(s.products).filter(p => filter === "all" || p.type === filter);
    products.sort((a, b) => sort === "return1" ? (b.return1 ?? -Infinity) - (a.return1 ?? -Infinity) : a[sort] - b[sort]);
    const node = byId("wealth-product-list");
    node.replaceChildren();
    if (!products.length) node.append(el("p", "该类别还没有产品笔记。登记官方资料后再比较，未知收益不会填零。"));
    for (const p of products) {
      const card = el("article", undefined, "wealth-product-card");
      card.append(el("span", names[p.type] + " · 风险 " + p.risk + " / 5 · 自行登记", "wealth-caption"), el("h3", p.name), el("p", p.issuer + " · 核对 " + p.checkedOn));
      card.append(el("p", "年度费率 " + p.fee + "% / 一次性投入费率 " + p.entryFee + "% / 最低起投 " + money(p.minimum)), el("p", "取用条件：" + p.liquidity));
      card.append(el("p", "历史年化 1年 " + (p.return1 === null ? "未知" : p.return1 + "%") + " / 5年 " + (p.return5 === null ? "未知" : p.return5 + "%") + " / 10年 " + (p.return10 === null ? "未知" : p.return10 + "%") + "。不同时间区间、币种、扣费口径未验证，不作为推荐排名。"));
      if (p.url) { const link = el("a", "查看登记来源 · 尚未平台核验"); link.href = F.safeUrl(p.url); link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(link); }
      else card.append(el("p", "没有原始链接，资料未核验。", "wealth-warning"));
      const t = F.trial(p, s.valuations);
      if (t) {
        card.append(el("p", "自报试投开始 " + p.startedOn + " / 初始金额 " + money(p.principal) + " / 六个月观察日 " + t.due));
        card.append(el("p", "开始日与预期均为自行登记；补录旧试投只作回顾，不算平台当时的预测。", "wealth-caption"));
        if (t.waiting) card.append(el("p", "尚无结果估值，不能评价收益或观察完成。"));
        else {
          card.append(el("p", "截至 " + t.date + "，成本后损益 " + money(t.profit) + "；" + (t.simple === null ? "有追加投入，仅报金额，不伪算资金加权收益" : "简单总回报 " + percent(t.simple)) + "。"));
          card.append(el("p", t.mature ? "估值日期已覆盖至少六个月；仍不足以证明稳定年收益，不能据此自动扩大。" : "观察未满六个月，保留未成熟状态。"));
          if (t.annualized !== null) card.append(el("p", "持有满一年且无中途资金流，年化回报 " + percent(t.annualized) + "。"));
          if (t.expectedValue !== null) card.append(el("p", "按登记时冻结假设的同天数对照值 " + money(t.expectedValue) + "，与当前剩余市值相差 " + money(t.value - t.expectedValue) + "；偏差不等于策略优劣。"));
        }
      }
      const edit = el("button", "更新资料", "wealth-secondary"); edit.type = "button";
      edit.addEventListener("click", () => { fill(byId("wealth-product"), p); byId("wealth-product-editor").open = true; byId("wealth-product").elements.namedItem("name").focus(); }); card.append(edit); node.append(card);
    }
    const selector = byId("wealth-valuation").elements.namedItem("productId"), current = selector.value;
    selector.replaceChildren();
    for (const p of Object.values(s.products).filter(p => p.startedOn && p.principal > 0)) { const option = el("option", p.name); option.value = p.id; selector.append(option); }
    if (!selector.options.length) { const o = el("option", "先登记试投产品"); o.value = ""; selector.append(o); }
    if (Array.from(selector.options).some(o => o.value === current)) selector.value = current;
  }
  function renderReview(s) {
    const cash = byId("wealth-cashflow-result");
    const rows = Object.values(s.cashflows).sort((a, b) => b.month.localeCompare(a.month));
    if (rows.length) {
      cash.replaceChildren(el("h3", "实际收支记录"), table(["月份", "收入", "支出含还款", "结余"], rows.slice(0,12).map(r => [r.month, money(r.income), money(r.essential + r.flexible + r.repayment), money(r.income - r.essential - r.flexible - r.repayment)]), "每月实际收支"));
      if (s.profile) { const latest = rows[0]; cash.append(el("p", "最近一月实际结余与预算差 " + money(latest.income - latest.essential - latest.flexible - latest.repayment - F.budget(s.profile).surplus) + "，没有自动改写预算。")); }
    }
    const stage = byId("wealth-stage");
    const trials = Object.values(s.products).map(p => F.trial(p, s.valuations)).filter(Boolean);
    const mature = trials.filter(t => t.mature).length;
    stage.replaceChildren(el("p", "学习检查 " + s.learning.length + " / " + F.LESSONS.length + "；试投记录 " + trials.length + " 个，其中估值覆盖六个月的 " + mature + " 个。"));
    stage.append(el("p", s.learning.length < F.LESSONS.length ? "当前重点：知识与资金准备。理解少量产品比机械凑数量更有用。" : mature === 0 ? "当前重点：小额观察。按真实开始日积累，旧资料补录属于自报回顾，不是平台当时的预测。" : "可以做阶段复盘；是否增加资金仍要复核闲钱、目标期限、费用和最差承受结果，不因一个盈利样本自动升级。"));
    const last = s.reviews.at(-1);
    stage.append(el("p", last ? "下次自定复盘：" + last.payload.nextOn + (last.payload.nextOn <= F.today() ? " · 已到期，建议复核" : "") : "可以先设一个约半年后的复盘日；年度检查目标和风险，不默认每日调参。"));
    const list = byId("wealth-review-list"); list.replaceChildren();
    for (const r of s.reviews.slice(-4).reverse()) { const entry = el("article", undefined, "wealth-review-entry"); entry.append(el("h4", "复盘 " + r.at.slice(0, 10)), el("p", r.payload.reason), el("p", "后续：" + r.payload.action), el("small", "下次：" + r.payload.nextOn)); list.append(entry); }
  }
  function render() {
    const s = F.state(events);
    renderBudget(s); renderGoal(s); renderRetirement(s); renderProducts(s); renderReview(s);
    byId("wealth-history-count").textContent = events.length + "条追加版本 · 人工确认=true · 自动交易=false · 旧A股规则与账本未变";
    const history = byId("wealth-history"); history.replaceChildren();
    for (const e of events.slice(-15).reverse()) history.append(el("p", e.at.slice(0,19).replace("T", " ") + " UTC · " + eventNames[e.type] + " · " + e.id.slice(0,8)));
  }
  for (const link of root.querySelectorAll("[data-open-finance]")) link.addEventListener("click", () => { byId(link.dataset.openFinance).open = true; });
  bind("wealth-profile", "profile", form => {
    const p = values(form, ["debtRate"]);
    for (const k of ["reserveMonths", "horizon", "lossTolerance"]) p[k] = Number(p[k]);
    return p;
  });
  bind("wealth-goal", "goal"); bind("wealth-retirement", "retirement");
  bind("wealth-product", "product", form => {
    const p = values(form, ["return1", "return5", "return10", "expected"]);
    if (!p.id) p.id = uid(); p.risk = Number(p.risk); form.elements.namedItem("id").value = p.id;
    if (p.url) p.url = F.safeUrl(p.url);
    return p;
  });
  bind("wealth-valuation", "valuation"); bind("wealth-cashflow", "cashflow"); bind("wealth-review", "review");
  bind("wealth-learning", "learning", form => ({completed: new FormData(form).getAll("completed")}));
  byId("wealth-new-product").addEventListener("click", () => { byId("wealth-product").reset(); byId("wealth-product").elements.namedItem("id").value = ""; byId("wealth-product").elements.namedItem("checkedOn").value = F.today(); message(byId("wealth-product"), "正在登记新的产品笔记。"); });
  for (const id of ["wealth-product-filter", "wealth-product-sort"]) byId(id).addEventListener("change", () => renderProducts(F.state(events)));
  function download(content, filename) {
    const url = URL.createObjectURL(new Blob([content], {type: "application/json"}));
    const a = el("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  byId("wealth-export").addEventListener("click", () => {
    download(pack(events), "tianxing-personal-" + F.today() + ".json"); byId("wealth-backup-status").textContent = "已生成当前个人记录的备份，包含敏感财务信息，请妥善保存。";
  });
  byId("wealth-export-original").addEventListener("click", () => { download(originalRaw || "", "tianxing-original-recovery.json"); byId("wealth-backup-status").textContent = "已导出保留的异常原档；当前临时记录未覆盖它。"; });
  byId("wealth-import").addEventListener("change", async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error("备份超过5MB");
      const imported = unpack(await file.text());
      const current = persistent ? F.merge(events, unpack(localStorage.getItem(KEY))) : events;
      const next = F.merge(current, imported), added = next.length - current.length;
      const saved = commit(next);
      for (const k of ["profile", "goal", "retirement"]) fill(byId("wealth-" + k), F.state(events)[k]);
      byId("wealth-backup-status").textContent = "已合并 " + added + " 条新记录；同编号去重，旧内容没有覆盖。" + (saved ? "已存本机。" : "仅在内存，请导出备份。");
    } catch (error) { byId("wealth-backup-status").textContent = "没有导入：" + error.message; }
    event.target.value = "";
  });
  window.addEventListener("storage", event => { if (event.key === KEY) byId("wealth-storage-status").textContent = "其他标签页更新了个人记录。当前表单暂保留，保存时会合并版本；重新打开页面可读取最新概览。"; });
  const saved = F.state(events);
  for (const k of ["profile", "goal", "retirement"]) fill(byId("wealth-" + k), saved[k]);
  for (const input of byId("wealth-learning").querySelectorAll('input[name="completed"]')) input.checked = saved.learning.includes(input.value);
  const day = F.today();
  for (const formId of ["wealth-product", "wealth-valuation"]) for (const input of byId(formId).querySelectorAll('input[type="date"]')) { input.max = day; if (["checkedOn", "date"].includes(input.name)) input.value = day; }
  byId("wealth-cashflow").elements.namedItem("month").value = day.slice(0,7);
  const next = new Date(day + "T00:00:00Z"); next.setUTCMonth(next.getUTCMonth() + 6);
  byId("wealth-review").elements.namedItem("nextOn").value = next.toISOString().slice(0,10);
  const annualEnd = 20000 * (Math.pow(1.08, 25) - 1) / 0.08;
  const monthlyEnd = F.project({principal:0, monthly:20000/12, years:25, annualReturn:8, fee:0, inflation:0, entryFee:0, timing:"end"}).value;
  byId("wealth-frequency").append(table(["同为每年投入2万元", "25年期末金额"], [["每年年末投入", money(annualEnd)], ["每月月末投入", money(monthlyEnd)], ["每年年初投入", money(annualEnd * 1.08)]], "投入时点比较"), el("p", "仅为固定有效年收益8%、不计费用税费的算术演示，累计本金50万元；不是产品回报预测。"));
  render();
})();

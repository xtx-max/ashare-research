"use strict";

// Deterministic personal planning. No network, storage, market forecasts or orders.
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.personalFinance = api;
})(typeof window === "object" ? window : this, () => {
  const VERSION = "personal-finance-v1";
  const TYPES = ["deposit", "cash", "bond", "ashare_etf", "ashare_stock"];
  const LESSONS = ["cash", "risk", "fees", "liquidity", "diversification", "sources"];
  function number(value, name, min = 0, max = 1e10) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(name + "超出允许范围");
    return value;
  }
  function text(value, name, max = 300) {
    if (typeof value !== "string" || value.length > max || !value.trim()) throw new Error(name + "不能为空或过长");
    return value.trim();
  }
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value) throw new Error("日期无效");
    return value;
  }
  const today = () => {
    const parts = new Intl.DateTimeFormat("en", {timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(new Date());
    const get = type => parts.find(p => p.type === type).value;
    return get("year") + "-" + get("month") + "-" + get("day");
  };
  function past(value, clock) {
    date(value);
    if (value > clock) throw new Error("事实日期不能在未来");
    return value;
  }
  function profile(p) {
    for (const k of ["income", "essential", "flexible", "repayment", "cash", "invested", "debt", "earmarked"]) number(p[k], k);
    if (p.debtRate !== null) number(p.debtRate, "借款年利率", 0, 100);
    number(p.reserveMonths, "应急月数", 3, 12);
    number(p.horizon, "投资期限", 0, 60);
    number(p.lossTolerance, "可接受亏损", 0, 100);
    if (!["stable", "variable"].includes(p.incomeType)) throw new Error("收入稳定性无效");
    return p;
  }
  function budget(p) {
    profile(p);
    const obligations = p.essential + p.repayment;
    const spending = obligations + p.flexible;
    const surplus = p.income - spending;
    const availableCash = Math.max(0, p.cash - p.earmarked);
    const reserveTarget = obligations * p.reserveMonths;
    const reserveGap = Math.max(0, reserveTarget - availableCash);
    const debtUnknown = p.debt > 0 && p.debtRate === null;
    // 6% is an explicit review trigger, not a promised investment return.
    const costlyDebt = p.debt > 0 && p.debtRate !== null && p.debtRate >= 6;
    const reserveContribution = Math.min(Math.max(0, surplus), costlyDebt ? Math.max(0, obligations - availableCash) : reserveGap);
    const debtContribution = costlyDebt ? Math.min(p.debt, Math.max(0, surplus - reserveContribution)) : 0;
    const planMonthly = reserveGap > reserveContribution || debtUnknown || costlyDebt ? 0 : Math.max(0, surplus - reserveContribution);
    const planCapital = surplus < 0 || reserveGap > 0 || debtUnknown || costlyDebt ? 0 : Math.max(0, availableCash - reserveTarget);
    let priority = "先保护日常生活，再研究长期投资";
    let detail = "收入减去支出与还款，才是可安排的月结余。应急金和近期用途资金先单独留出。";
    if (surplus < 0) { priority = "先让现金流回到收支平衡"; detail = "目前每月支出与还款超过收入。优先削减可选支出、核对还款安排；暂停新增风险投入。"; }
    else if (debtUnknown) { priority = "先核对借款实际年利率"; detail = "有负债但年利率未知，暂不估计可投资金额。请计入服务费，并核实提前还款费用。"; }
    else if (costlyDebt) { priority = "留出基本周转金，优先复核高成本负债"; detail = "借款年利率达到6%的规划复核线。先留至少一个月必要支出与还款，再考虑额外偿还；应急金总目标仍保留，须核对违约金。"; }
    else if (reserveGap > 0) { priority = "本阶段先补应急金"; detail = "应急目标按必要生活支出与固定还款计算；近期用途资金不重复计入。目标补齐前，新增风险投入暂缓。"; }
    else if (p.horizon < 3) { priority = "这笔钱近期要用，以流动性和本金风险为先"; detail = "三年内要使用的资金不依赖股票上涨来完成目标。先比较存款、现金管理的期限、保障范围与赎回条件。"; }
    else { priority = "基础资金已有安排，按目标做小额验证"; detail = "先看目标是否可负担，再看产品费用、流动性和最差结果。A股关注条件在下方，不因现金充足就追涨。"; }
    return {surplus, spending, obligations, availableCash, reserveTarget, reserveGap, reserveContribution, debtContribution, planMonthly, planCapital, debtUnknown, costlyDebt, priority, detail,
      netAssets: p.cash + p.invested - p.debt, reserveCoverage: obligations > 0 ? availableCash / obligations : null,
      savingsRate: p.income > 0 ? surplus / p.income : null,
      stressLoss: p.invested * 0.3, stressCashMonths: obligations > 0 ? availableCash / obligations : null};
  }
  function terms(p) {
    number(p.principal, "初始本金"); number(p.monthly, "每月投入", 0, 1e8);
    number(p.years, "年数", 1 / 12, 60); number(p.annualReturn, "演算年收益率", -50, 30);
    number(p.fee, "年度费用", 0, 5); number(p.inflation, "通胀假设", 0, 15);
    number(p.entryFee, "投入费用", 0, 10);
    if (!["end", "begin"].includes(p.timing)) throw new Error("投入时点无效");
    const months = Math.round(p.years * 12);
    if (Math.abs(months - p.years * 12) > 1e-7) throw new Error("期限必须为完整月数");
    const annualNet = (1 + p.annualReturn / 100) * (1 - p.fee / 100) - 1;
    const rate = Math.expm1(Math.log1p(annualNet) / 12);
    const growth = Math.pow(1 + rate, months);
    const factor = Math.abs(rate) < 1e-12 ? months : Math.expm1(Math.log1p(rate) * months) / rate;
    const annuity = factor * (p.timing === "begin" ? 1 + rate : 1);
    return {months, annualNet, rate, growth, annuity};
  }
  function project(p) {
    const t = terms(p), paid = p.principal + p.monthly * t.months;
    const value = (p.principal * t.growth + p.monthly * t.annuity) * (1 - p.entryFee / 100);
    return {value, realValue: value / Math.pow(1 + p.inflation / 100, p.years), paid, gain: value - paid, annualNet: t.annualNet};
  }
  function requiredMonthly(p, target) {
    number(target, "目标金额", 0, 1e15);
    const t = terms(p), net = 1 - p.entryFee / 100;
    return Math.max(0, (target / net - p.principal * t.growth) / t.annuity);
  }
  function goal(p) {
    project(p); number(p.target, "目标现值", 1, 1e10);
    const targetFuture = p.target * Math.pow(1 + p.inflation / 100, p.years);
    const scenarios = [-3, 0, 3].map(delta => {
      const scenario = {...p, annualReturn: Math.max(-50, Math.min(30, p.annualReturn + delta))};
      return {...project(scenario), annualReturn: scenario.annualReturn, required: requiredMonthly(scenario, targetFuture)};
    });
    const trajectory = [];
    for (let year = 1; year <= Math.ceil(p.years); year++) {
      const years = Math.min(year, p.years);
      const row = {year: years, paid: p.principal + p.monthly * Math.round(years * 12)};
      for (const [i, delta] of [-3, 0, 3].entries()) row["s" + i] = project({...p, years, annualReturn: Math.max(-50, Math.min(30, p.annualReturn + delta))}).realValue;
      trajectory.push(row);
    }
    return {targetFuture, scenarios, trajectory};
  }
  function retirement(p) {
    number(p.age, "当前年龄", 16, 90); number(p.retireAge, "计划退休年龄", 17, 100); number(p.endAge, "规划至年龄", 18, 110);
    if (![p.age, p.retireAge, p.endAge].every(Number.isInteger) || p.retireAge <= p.age || p.endAge <= p.retireAge) throw new Error("年龄须递增：当前 < 退休 < 规划至");
    number(p.monthlyGap, "退休月缺口", 0, 1e7); number(p.postReturn, "退休后名义年收益", -20, 15);
    const years = p.retireAge - p.age;
    const t = terms({...p, years});
    const netPost = (1 + p.postReturn / 100) * (1 - p.fee / 100);
    const realMonthly = Math.pow(netPost / (1 + p.inflation / 100), 1 / 12) - 1;
    const months = (p.endAge - p.retireAge) * 12;
    const pvFactor = Math.abs(realMonthly) < 1e-12 ? months : -Math.expm1(-months * Math.log1p(realMonthly)) / realMonthly * (1 + realMonthly);
    const todayNeed = p.monthlyGap * pvFactor;
    const retirementNeed = todayNeed * Math.pow(1 + p.inflation / 100, years);
    return {todayNeed, retirementNeed, required: requiredMonthly({...p, years}, retirementNeed), years, retirementMonths: months, realPostAnnual: Math.pow(1 + realMonthly, 12) - 1,
      projected: (p.principal * t.growth + p.monthly * t.annuity) * (1 - p.entryFee / 100)};
  }
  function safeUrl(value) {
    if (value === "") return "";
    text(value, "来源链接", 1200);
    let u; try { u = new URL(value); } catch { throw new Error("来源须为HTTPS链接"); }
    if (u.protocol !== "https:" || u.username || u.password) throw new Error("来源须为无账号密码的HTTPS链接");
    return u.href;
  }
  function product(p, clock) {
    text(p.id, "产品编号", 80); text(p.name, "产品名称", 100); text(p.issuer, "发行机构", 100);
    if (!TYPES.includes(p.type)) throw new Error("产品类别超出范围");
    number(p.risk, "来源风险等级", 1, 5); if (!Number.isInteger(p.risk)) throw new Error("风险等级须为整数");
    number(p.fee, "年度费率", 0, 10); number(p.entryFee, "买入费率", 0, 10); number(p.minimum, "最低起投", 0, 1e8);
    text(p.liquidity, "流动性", 160); safeUrl(p.url); past(p.checkedOn, clock);
    for (const k of ["return1", "return5", "return10"]) if (p[k] !== null) number(p[k], "历史年化", -100, 300);
    if (p.expected !== null) number(p.expected, "自设对照年化", -50, 30);
    if (p.startedOn !== "") past(p.startedOn, clock);
    number(p.principal, "试投初始金额", 0, 1e8);
    if ((p.principal > 0) !== (p.startedOn !== "")) throw new Error("试投日期与初始金额须同时填写；未试投请填0并留空日期");
    return p;
  }
  function validateEvent(e, clock = today()) {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("记录格式无效");
    if (Object.keys(e).sort().join() !== ["at", "id", "payload", "type"].join()) throw new Error("记录包含未知字段");
    text(e.id, "记录编号", 100);
    if (typeof e.at !== "string" || !/^\d{4}-\d\d-\d\dT/.test(e.at) || !Number.isFinite(Date.parse(e.at)) || e.at.length > 40 || new Date(e.at).toISOString().slice(0,10) > clock) throw new Error("记录时间无效或在未来");
    const p = e.payload;
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("记录内容无效");
    const fields = {
      profile: ["income", "essential", "flexible", "repayment", "cash", "invested", "debt", "debtRate", "earmarked", "reserveMonths", "incomeType", "horizon", "lossTolerance"],
      goal: ["principal", "monthly", "years", "annualReturn", "fee", "inflation", "entryFee", "timing", "target"],
      retirement: ["principal", "monthly", "annualReturn", "fee", "inflation", "entryFee", "timing", "age", "retireAge", "endAge", "monthlyGap", "postReturn"],
      product: ["id", "name", "issuer", "type", "risk", "fee", "entryFee", "minimum", "liquidity", "url", "checkedOn", "return1", "return5", "return10", "expected", "startedOn", "principal"],
      valuation: ["productId", "date", "value", "added", "withdrawn"],
      cashflow: ["month", "income", "essential", "flexible", "repayment"],
      learning: ["completed"], review: ["reason", "action", "nextOn"]
    };
    if (!fields[e.type] || Object.keys(p).sort().join() !== fields[e.type].slice().sort().join()) throw new Error("记录字段或版本不兼容");
    if (e.type === "profile") profile(p);
    if (e.type === "goal") goal(p);
    if (e.type === "retirement") retirement(p);
    if (e.type === "product") product(p, clock);
    if (e.type === "valuation") { text(p.productId, "产品编号", 80); past(p.date, clock); for (const k of ["value", "added", "withdrawn"]) number(p[k], k); }
    if (e.type === "cashflow") { if (!/^\d{4}-\d{2}$/.test(p.month)) throw new Error("月份无效"); past(p.month + "-01", clock); for (const k of ["income", "essential", "flexible", "repayment"]) number(p[k], k); }
    if (e.type === "learning" && (!Array.isArray(p.completed) || p.completed.some(x => !LESSONS.includes(x)) || new Set(p.completed).size !== p.completed.length)) throw new Error("学习检查项无效");
    if (e.type === "review") { text(p.reason, "复盘事实", 1200); text(p.action, "后续动作", 1200); date(p.nextOn); }
    return e;
  }
  function merge(existing, incoming, clock = today()) {
    if (!Array.isArray(existing) || !Array.isArray(incoming) || existing.length + incoming.length > 10000) throw new Error("记录数量过多");
    const entries = new Map();
    for (const e of [...existing, ...incoming]) {
      validateEvent(e, clock);
      const previous = entries.get(e.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(e)) throw new Error("同编号内容冲突，旧记录未覆盖");
      entries.set(e.id, e);
    }
    if (entries.size > 5000) throw new Error("本机记录超过5000条，请先导出备份");
    const result = [...entries.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
    const products = new Map();
    for (const e of result) {
      if (e.type === "product") {
        const previous = products.get(e.payload.id);
        if (previous?.startedOn && ["startedOn", "principal", "expected"].some(k => previous[k] !== e.payload[k])) throw new Error("已登记试投的初始金额、开始日和预期对照不能改写；请新建独立试投");
        products.set(e.payload.id, e.payload);
      }
      if (e.type === "valuation") {
        const p = products.get(e.payload.productId);
        if (!p || !p.startedOn || e.payload.date < p.startedOn) throw new Error("估值须关联已登记试投，日期不得早于试投开始");
      }
    }
    return result;
  }
  function state(events) {
    const result = {products: Object.create(null), valuations: [], cashflows: Object.create(null), reviews: [], learning: []};
    for (const e of events) {
      if (["profile", "goal", "retirement"].includes(e.type)) result[e.type] = e.payload;
      if (e.type === "product") result.products[e.payload.id] = e.payload;
      if (e.type === "valuation") result.valuations.push(e);
      if (e.type === "cashflow") result.cashflows[e.payload.month] = e.payload;
      if (e.type === "review") result.reviews.push(e);
      if (e.type === "learning") result.learning = e.payload.completed;
    }
    return result;
  }
  function trial(p, valuations, clock = today()) {
    if (!p.startedOn || p.principal <= 0) return null;
    const latest = valuations.filter(e => e.payload.productId === p.id && e.payload.date >= p.startedOn && e.payload.date <= clock).sort((a, b) => a.payload.date.localeCompare(b.payload.date) || Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id)).at(-1);
    const sixMonths = new Date(p.startedOn + "T00:00:00Z");
    const day = sixMonths.getUTCDate(); sixMonths.setUTCDate(1); sixMonths.setUTCMonth(sixMonths.getUTCMonth() + 6);
    const endDay = new Date(Date.UTC(sixMonths.getUTCFullYear(), sixMonths.getUTCMonth() + 1, 0)).getUTCDate();
    sixMonths.setUTCDate(Math.min(day, endDay));
    const due = sixMonths.toISOString().slice(0, 10);
    if (!latest) return {due, mature: false, waiting: true};
    const v = latest.payload, days = (Date.parse(v.date) - Date.parse(p.startedOn)) / 86400000;
    const profit = v.value + v.withdrawn - p.principal - v.added;
    const simple = v.added === 0 ? profit / p.principal : null;
    const annualized = days >= 365 && v.added === 0 && v.withdrawn === 0 && v.value > 0 ? Math.pow(v.value / p.principal, 365 / days) - 1 : null;
    return {date: v.date, value: v.value, days, profit, simple, annualized, due, mature: v.date >= due, waiting: false,
      comparable: v.added === 0 && v.withdrawn === 0,
      expectedValue: p.expected !== null && v.added === 0 && v.withdrawn === 0 ? p.principal * Math.pow(1 + p.expected / 100, days / 365) : null};
  }
  return {VERSION, TYPES, LESSONS, today, budget, project, requiredMonthly, goal, retirement, safeUrl, validateEvent, merge, state, trial};
});

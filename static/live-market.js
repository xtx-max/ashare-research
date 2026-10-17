"use strict";

(() => {
  const refreshButton = document.getElementById("refresh-market");
  if (!refreshButton) return;
  const status = document.getElementById("live-market-status");
  const time = document.getElementById("live-market-time");
  const sessions = {INTRADAY: "盘中报价", CLOSED: "今日收盘", MIDDAY_BREAK: "午间休市", PREOPEN: "开盘前", PREVIOUS_SESSION: "上次交易快照", DELAYED: "报价有延迟"};
  const format = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString("zh-CN", {minimumFractionDigits: digits, maximumFractionDigits: digits}) : "—";
  const stamp = value => value ? value.slice(0, 10) + " " + value.slice(11, 19) : "时间未知";
  let currentReport, running = false, resolveReady, pollTimer;
  const chartRequests = new Map();
  const ready = new Promise(resolve => { resolveReady = resolve; });

  async function post(route, value) {
    if (window.hostedMarket) return window.hostedMarket.post(route, value);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(route, {method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: {"Content-Type": "application/json", "X-Local-CSRF": document.querySelector('meta[name="local-csrf"]').content},
        body: JSON.stringify(value)});
      const result = await response.json();
      if (!response.ok) throw new Error("local market request unavailable");
      return result;
    } finally { clearTimeout(deadline); }
  }

  function renderQuotes(report) {
    for (const card of document.querySelectorAll("[data-live-security]")) {
      const quote = report.quotes?.[card.dataset.liveSecurity];
      const price = card.querySelector(".live-price"), change = card.querySelector(".live-change");
      card.classList.remove("is-up", "is-down", "quote-unavailable");
      if (!quote) {
        price.textContent = "—"; change.textContent = "未取得报价";
        card.classList.add("quote-unavailable");
        card.querySelector(".live-session").textContent = "来源暂不可用";
        card.querySelector(".live-quote-time").textContent = "没有用昨日收盘替代最新价格。";
        card.querySelector(".live-reading").textContent = "可重试刷新；下方有日期的收盘研究仍可查阅。";
        continue;
      }
      price.textContent = format(quote.price, card.dataset.liveSecurity === "510300.SH" ? 3 : 2);
      change.textContent = (quote.change_pct > 0 ? "+" : "") + format(quote.change_pct) + "%";
      const noTrades = quote.has_current_session_trades === false;
      card.querySelector(".live-quote-top>span:first-child").textContent = noTrades ? "最近成交价" : "最新价";
      card.classList.add(quote.change_pct >= 0 ? "is-up" : "is-down");
      card.querySelector(".live-session").textContent = noTrades ? "来源显示今日无成交" : sessions[quote.session] || "待核验报价";
      card.querySelector(".live-quote-time").textContent = quote.source + " · " + stamp(quote.as_of) + (noTrades ? " · 今日无成交，沿用最近成交价" : " · 今开 " + format(quote.open) + " / 高 " + format(quote.high) + " / 低 " + format(quote.low));
      const reading = card.querySelector(".live-reading");
      if (noTrades) {
        reading.textContent = "来源没有今天的新成交，价格是最近成交价；不生成今天的K线，也不据此确认新买入条件。";
      } else if (["PREVIOUS_SESSION", "DELAYED"].includes(quote.session)) {
        reading.textContent = "来源时间不是当前盘中报价，请按上面的实际时间判断；可再次刷新。";
      } else if (card.dataset.liveSecurity === "000300.SH" && Number(card.dataset.researchThreshold) > 0) {
        const threshold = Number(card.dataset.researchThreshold);
        const distance = (quote.price / threshold - 1) * 100;
        reading.textContent = "最新指数距五年度均价 " + (distance > 0 ? "+" : "") + format(distance) + "%；" + (distance <= 0 ? "价格已到观察区间，收盘后再确认。" : "当前仍高于该规则的配置区间，继续等条件。") ;
      } else if (card.dataset.qualified !== "true" && card.dataset.liveSecurity !== "510300.SH") {
        reading.textContent = "最新价格用于观察走势；财务未通过或未能判断，不升级为长线买入候选。";
      } else {
        reading.textContent = card.dataset.liveSecurity === "510300.SH" ? "这是ETF市场价格；净值和折溢价仍须按各自实际日期判断。" : "最新价格已更新；最新K线将给出盘中价位试算，收盘后确认正式条件。";
      }
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        price.animate([{opacity: 0.35, transform: "translateY(4px)"}, {opacity: 1, transform: "translateY(0)"}], {duration: 260, easing: "ease-out"});
      }
    }
  }

  function inspectChart(event) {
    const chart = event.detail;
    const bar = chart.daily?.at(-1), prices = bar?.qfq;
    if (chart.status === "HISTORICAL_ONLY" || ["PREVIOUS_SESSION", "DELAYED"].includes(chart.session)) return;
    const analysis = chart.analysis;
    if (analysis) {
      for (const article of document.querySelectorAll('[data-stock-type="trend"]')) {
        if (article.dataset.stock !== chart.security_id) continue;
        article.querySelector(".evidence-caption").textContent = "下方指标已用 " + stamp(analysis.as_of) + " 行情重新试算" + (analysis.provisional ? "；今日未收盘，收盘后再确认。" : "；既有选股排名仍是保存的收盘研究。") ;
        for (const key of ["return_20", "relative_20", "volume_ratio"]) {
          const indicator = article.querySelector('[data-live-indicator="' + key + '"]');
          if (!indicator) continue;
          const value = analysis[key];
          indicator.querySelector("strong").textContent = !Number.isFinite(value) ? "资料不足" : key === "volume_ratio" ? format(value) + " 倍" : (value > 0 ? "+" : "") + format(value * 100) + (key === "relative_20" ? " 个百分点" : "%");
          const verdict = indicator.querySelector(".indicator-verdict");
          if (verdict) {
            const target = Number((indicator.querySelector("small").textContent.match(/≥([\d.]+)/) || [])[1]);
            const passed = Number.isFinite(value) && value >= (key === "relative_20" ? target / 100 : target);
            verdict.textContent = !Number.isFinite(value) ? "未能判断" : passed ? "满足" : "未满足";
            verdict.className = "indicator-verdict " + (passed ? "is-pass" : "is-fail");
          }
        }
        const relativeLimit = Number(article.dataset.relativeLimit), volumeLimit = Number(article.dataset.volumeLimit);
        const readingPrefix = analysis.provisional ? "盘中复核：" : "最新行情复核：";
        article.querySelector(".stock-thesis").textContent = readingPrefix + (analysis.relative_20 === null || analysis.volume_ratio === null ? "部分指标缺同期数据，先观察；不据此更改原研究排名。" : analysis.relative_20 >= relativeLimit && analysis.volume_ratio >= volumeLimit && analysis.above_ma20 ? "相对强弱、量能和MA20位置仍符合观察条件；仅本观察池的临时解读，财务未通过仍不作长线候选。" : "当前至少一项动量条件已不满足，谨慎观察，等正式研究确认；原留档候选不被改写。");
        article.querySelector('[data-live-indicator="volume_ratio"] p').textContent = "最近5日均量 / 此前16日均量；" + (analysis.provisional ? "今日成交量尚未累计完，当前倍数是临时值。" : "使用最新已完成日线；放量反映交易活跃，也可能伴随分歧。");
      }
    }
    if (!Number.isFinite(prices?.ma?.[120])) return;
    const threshold = 0.85 * prices.ma[120];
    const distance = (prices.close / threshold - 1) * 100;
    for (const card of document.querySelectorAll("[data-live-security]")) {
      if (card.dataset.liveSecurity !== chart.security_id || card.dataset.qualified !== "true") continue;
      card.querySelector(".live-reading").textContent = (bar.provisional ? "盘中试算" : "最新行情试算") + "：同源前复权MA120 " + format(prices.ma[120]) + "，85%价位 " + format(threshold) + " 元，距价位 " + (distance > 0 ? "+" : "") + format(distance) + "%；" + (bar.provisional ? "含今日未定收盘，正式条件等收盘后保存研究。" : "仅作当前价位参考，未改写已留档规则结果。") ;
    }
  }

  async function readChart(code) {
    await ready;
    if (!chartRequests.has(code)) chartRequests.set(code, post("/api/market-chart", {security_id: code}).then(data => {
      if (!["PASS", "HISTORICAL_ONLY"].includes(data.status)) throw new Error("live chart unavailable");
      return data;
    }).catch(error => { chartRequests.delete(code); throw error; }));
    const data = await chartRequests.get(code);
    document.dispatchEvent(new CustomEvent("market:chart", {detail: data}));
    return data;
  }

  function preloadVisibleAnalysis() {
    for (const type of ["trend", "company"]) {
      for (const article of [...document.querySelectorAll('[data-stock-type="' + type + '"]')].slice(0, 3)) {
        readChart(article.dataset.stock).catch(() => {
          const note = article.querySelector(".evidence-caption");
          if (note) note.textContent += " 最新指标试算暂未取得，以上仍为有日期的收盘依据。";
        });
      }
    }
  }

  async function watchResearch(started, attempt = 0) {
    if (attempt >= 24) return;
    try {
      const response = await fetch("/api/data-status", {credentials: "same-origin"});
      if (!response.ok) return;
      const result = await response.json();
      const run = result.last_worker_run;
      const finished = Date.parse(run?.finished_at || "");
      if (finished >= started && ["PASS", "PARTIAL"].includes(run.status)) {
        const response = await fetch("/api/home-content", {credentials: "same-origin"});
        if (!response.ok) return;
        const content = await response.json();
        const documentContent = new DOMParser().parseFromString(content.html, "text/html");
        document.getElementById("analysis-content").replaceChildren(...documentContent.body.childNodes);
        const banner = document.querySelector(".data-banner");
        banner.querySelector("b").textContent = content.snapshot_state === "CURRENT" ? "收盘研究已更新" : "研究仍需核验，请按日期查阅";
        banner.querySelector("span:last-child").textContent = "收盘研究 " + (content.market_date || "未知");
        renderQuotes(currentReport);
        document.dispatchEvent(new CustomEvent("research:updated"));
        return;
      }
      if (finished >= started && run.status === "FAILED") {
        time.textContent += " · 收盘研究更新失败，保留原日期";
        return;
      }
    } catch { return; }
    pollTimer = setTimeout(() => watchResearch(started, attempt + 1), 5000);
  }

  async function refresh(reason) {
    if (running) return;
    running = true; refreshButton.disabled = true;
    document.querySelector(".market-refresh").classList.add("is-refreshing");
    status.textContent = "正在刷新最新行情…";
    const started = Date.now();
    try {
      chartRequests.clear();
      currentReport = await post("/api/market-refresh", {reason});
      const quotes = Object.values(currentReport.quotes || {});
      const dates = [...new Set(quotes.map(q => q.market_date))];
      const missing = Object.keys(currentReport.errors || {}).length;
      const noTrades = quotes.filter(q => q.has_current_session_trades === false).length;
      status.textContent = currentReport.status === "FAILED" ? "最新行情获取失败，可重试" : quotes.every(q => q.session === "PREVIOUS_SESSION") ? "返回上次交易行情，请看来源时间" : "行情已刷新 · " + quotes.length + " 个标的" + (missing ? "，" + missing + " 个暂缺" : "");
      if (noTrades) status.textContent += " · " + noTrades + " 个无新成交";
      time.textContent = dates.join(" / ") + " · 本次获取 " + stamp(currentReport.fetched_at) + " · 打开时更新，可手动刷新";
      renderQuotes(currentReport);
      resolveReady(currentReport);
      document.dispatchEvent(new CustomEvent("market:updated", {detail: currentReport}));
      preloadVisibleAnalysis();
      if (currentReport.research_update) {
        time.textContent += " · 收盘研究正在后台更新";
        clearTimeout(pollTimer);
        watchResearch(started);
      }
    } catch {
      currentReport = {status: "FAILED", quotes: {}};
      status.textContent = "行情暂未取得，点击刷新重试";
      time.textContent = "页面会话过期时请重载；没有把昨日价格标成实时。";
      renderQuotes(currentReport); resolveReady(currentReport);
      document.dispatchEvent(new CustomEvent("market:updated", {detail: currentReport}));
    } finally {
      running = false; refreshButton.disabled = false;
      document.querySelector(".market-refresh").classList.remove("is-refreshing");
    }
  }
  window.latestMarket = {ready, post, readChart};
  document.addEventListener("market:chart", inspectChart);
  document.addEventListener("research:updated", preloadVisibleAnalysis);
  refreshButton.addEventListener("click", () => refresh("manual"));
  window.addEventListener("pagehide", () => clearTimeout(pollTimer));
  refresh("page_open");
})();

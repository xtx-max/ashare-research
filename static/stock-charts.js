"use strict";

(() => {
  const requests = new Map();
  const controllers = new Map();
  const windows = [5, 10, 20, 60, 120];
  const colors = {up: "#d35c65", down: "#45a18a", grid: "#2a353e", text: "#a8b4bf"};
  const maColors = {5: "#d5bb73", 10: "#b7a6b8", 20: "#7ca8bd", 60: "#bd9479", 120: "#8eaa86"};
  const number = (value, digits = 2) => Number.isFinite(value) ? value.toLocaleString("zh-CN", {minimumFractionDigits: digits, maximumFractionDigits: digits}) : "—";
  const compact = (value, unit) => !Number.isFinite(value) ? "—" : value >= 1e8 ? number(value / 1e8) + " 亿" + unit : value >= 1e4 ? number(value / 1e4) + " 万" + unit : number(value) + " " + unit;

  function readSaved(chart) {
    const params = new URLSearchParams({security_id: chart.dataset.security});
    if (chart.dataset.snapshot) params.set("snapshot_hash", chart.dataset.snapshot);
    const url = "/api/kline?" + params;
    if (!requests.has(url)) {
      requests.set(url, fetch(url, {credentials: "same-origin"}).then(async response => {
        if (!response.ok) throw new Error("saved chart unavailable");
        const data = await response.json();
        if (!Array.isArray(data.daily) || !Array.isArray(data.weekly)) throw new Error("saved chart invalid");
        return data;
      }).catch(error => { requests.delete(url); throw error; }));
    }
    return requests.get(url);
  }

  async function readLatest(chart) {
    await window.latestMarket.ready;
    const key = "live:" + chart.dataset.security;
    if (!requests.has(key)) {
      requests.set(key, window.latestMarket.readChart(chart.dataset.security).then(data => {
        if (!["PASS", "HISTORICAL_ONLY"].includes(data.status) || !Array.isArray(data.daily) || !Array.isArray(data.weekly)) throw new Error("latest chart unavailable");
        return data;
      }).catch(error => { requests.delete(key); throw error; }));
    }
    return requests.get(key);
  }

  function initialise() {
    for (const [element, controller] of controllers) {
      if (!element.isConnected) { controller.dispose(); controllers.delete(element); }
    }
    for (const chart of document.querySelectorAll(".stock-chart")) {
    if (controllers.has(chart)) continue;
    const panel = chart.querySelector(".kline-panel");
    const canvas = chart.querySelector("canvas");
    const context = canvas.getContext("2d");
    const quote = chart.querySelector(".kline-quote");
    const legend = chart.querySelector(".kline-legend");
    const status = chart.querySelector(".kline-status");
    const source = chart.querySelector(".kline-source");
    const retry = chart.querySelector(".kline-retry");
    let data, loading = false, period = "daily", range = "60", basis = "qfq", mode = "live", revision = 0;
    let bars = [], selected = 0, cursor = false, pointerY = null, geometry, frame = null;

    const fields = {};
    for (const [key, title] of [["date", "日期"], ["open", "开"], ["high", "高"], ["low", "低"], ["close", "收"], ["change", "涨跌"], ["volume", "量"]]) {
      const cell = document.createElement("span");
      const label = document.createElement("small");
      label.textContent = title;
      const value = document.createElement("b");
      value.textContent = "—";
      cell.append(label, value);
      quote.append(cell);
      fields[key] = value;
    }
    legend.replaceChildren();
    const averages = {};
    for (const window of windows) {
      const item = document.createElement("span");
      item.className = "ma" + window;
      item.textContent = "MA" + window + " —";
      legend.append(item);
      averages[window] = item;
    }

    function updateQuote() {
      const bar = bars[selected];
      const prices = bar?.[basis];
      fields.date.textContent = bar ? (period === "weekly" ? bar.from_date + "～" + bar.date.slice(5) : bar.date) + (bar.provisional ? (period === "weekly" ? " · 本周未结束" : " · 未收盘") : "") : "—";
      for (const key of ["open", "high", "low", "close"]) fields[key].textContent = number(prices?.[key]);
      const change = prices?.change_pct;
      fields.change.textContent = Number.isFinite(change) ? (change > 0 ? "+" : "") + number(change) + "%" : "—";
      fields.change.className = Number.isFinite(change) ? change > 0 ? "quote-up" : change < 0 ? "quote-down" : "" : "";
      fields.volume.textContent = compact(bar?.volume_lots, "手");
      for (const window of windows) averages[window].textContent = "MA" + window + " " + number(prices?.ma?.[window]);
    }

    function draw() {
      if (!data || !chart.open || !context) return;
      const width = canvas.getBoundingClientRect().width;
      const height = canvas.getBoundingClientRect().height;
      if (!width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = "#17212a";
      context.fillRect(0, 0, width, height);
      const visible = bars.map(bar => bar[basis]).filter(Boolean);
      if (!visible.length) return;
      const prices = visible.flatMap(p => [p.low, p.high, ...Object.values(p.ma).filter(Number.isFinite)]);
      if (basis === "qfq" && period === "daily" && Number.isFinite(data.first_threshold)) prices.push(data.first_threshold);
      const min = Math.min(...prices), max = Math.max(...prices);
      const padding = (max - min || max * 0.04) * 0.08;
      const floor = min - padding, ceiling = max + padding;
      const left = 8, right = width - 52, top = 10, bottom = height * 0.67;
      const volumeTop = bottom + 23, volumeBottom = height - 25;
      const step = (right - left) / bars.length;
      const x = i => left + (i + 0.5) * step;
      const y = value => top + (ceiling - value) / (ceiling - floor) * (bottom - top);
      const maxVolume = Math.max(...bars.map(b => b.volume_lots), 1);
      geometry = {left, right, top, bottom, volumeBottom, step, x, y};
      context.font = '10px ui-monospace, "SFMono-Regular", Menlo, monospace';
      context.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const value = ceiling - (ceiling - floor) * i / 4;
        const lineY = y(value);
        context.strokeStyle = colors.grid;
        context.beginPath(); context.moveTo(left, lineY); context.lineTo(right, lineY); context.stroke();
        context.fillStyle = colors.text; context.fillText(number(value), right + 5, lineY + 3);
      }
      context.strokeStyle = colors.grid;
      context.beginPath(); context.moveTo(left, volumeTop); context.lineTo(right, volumeTop); context.stroke();
      context.fillStyle = colors.text;
      context.fillText("成交量（手）", left, volumeTop - 6);
      const bodyWidth = Math.max(1, Math.min(7, step * 0.66));
      for (let i = 0; i < bars.length; i++) {
        const prices = bars[i][basis];
        if (!prices) continue;
        const color = prices.close >= prices.open ? colors.up : colors.down;
        context.strokeStyle = color; context.fillStyle = color;
        context.beginPath(); context.moveTo(x(i), y(prices.high)); context.lineTo(x(i), y(prices.low)); context.stroke();
        const bodyTop = Math.min(y(prices.open), y(prices.close));
        context.fillRect(x(i) - bodyWidth / 2, bodyTop, bodyWidth, Math.max(1, Math.abs(y(prices.open) - y(prices.close))));
        const volumeHeight = bars[i].volume_lots / maxVolume * (volumeBottom - volumeTop);
        if (volumeHeight > 0) context.fillRect(x(i) - bodyWidth / 2, volumeBottom - volumeHeight, bodyWidth, volumeHeight);
      }
      for (const window of windows) {
        context.strokeStyle = maColors[window]; context.lineWidth = 1.2;
        context.beginPath(); let connected = false;
        for (let i = 0; i < bars.length; i++) {
          const value = bars[i][basis]?.ma?.[window];
          if (!Number.isFinite(value)) { connected = false; continue; }
          if (connected) context.lineTo(x(i), y(value)); else context.moveTo(x(i), y(value));
          connected = true;
        }
        context.stroke();
      }
      if (basis === "qfq" && period === "daily" && Number.isFinite(data.first_threshold)) {
        context.strokeStyle = "#9d9e86"; context.setLineDash([4, 4]);
        context.beginPath(); context.moveTo(left, y(data.first_threshold)); context.lineTo(right, y(data.first_threshold)); context.stroke();
        context.setLineDash([]); context.fillStyle = "#c7c8ac";
        context.fillText("首批研究阈值 " + number(data.first_threshold), left + 3, y(data.first_threshold) - 5);
      }
      context.fillStyle = colors.text;
      for (const index of [...new Set([0, Math.floor((bars.length - 1) / 2), bars.length - 1])]) {
        const text = bars[index].date.slice(5);
        const textWidth = context.measureText(text).width;
        context.fillText(text, Math.max(left, Math.min(right - textWidth, x(index) - textWidth / 2)), height - 7);
      }
      if (cursor && bars[selected]?.[basis]) {
        const crossY = pointerY === null ? y(bars[selected][basis].close) : Math.min(bottom, Math.max(top, pointerY));
        context.strokeStyle = "#a6b5c2"; context.lineWidth = 1; context.setLineDash([3, 3]);
        context.beginPath(); context.moveTo(x(selected), top); context.lineTo(x(selected), volumeBottom); context.stroke();
        context.beginPath(); context.moveTo(left, crossY); context.lineTo(right, crossY); context.stroke();
        context.setLineDash([]);
      }
    }

    function scheduleDraw() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; draw(); });
    }

    function show() {
      if (!data) return;
      const full = data[period];
      bars = range === "all" ? full : full.slice(-Number(range));
      selected = Math.max(0, bars.length - 1); cursor = false; pointerY = null;
      updateQuote();
      canvas.hidden = !bars.length;
      status.classList.remove("kline-error");
      if (!bars.length) {
        status.textContent = "暂无该标的已保存K线。不会补零或生成假行情；文字分析仍可阅读。";
      } else if (!bars.some(bar => bar[basis])) {
        status.textContent = "前复权因子不足；可切换“不复权”查看原始报价，不能据此判断除权后的走势。";
        status.classList.add("kline-error");
      } else {
        status.textContent = data.daily.length + " 个历史交易日 · 当前显示 " + bars.length + " 根" + (period === "daily" ? "日K" : "周K") + (data.status === "HISTORICAL_ONLY" ? (mode === "live" ? " · 来源显示今日无新成交；最后交易日 " + data.market_date + "，未生成今天K线" : " · 该股最新行情未覆盖研究日，仅历史查阅") : "");
        if (basis === "qfq" && data.missing_adjustment_dates?.length) status.textContent += " · " + data.missing_adjustment_dates.length + " 日缺因子，图形留空，不跨缺口计算均线";
        if (mode === "live") status.textContent += bars.at(-1)?.provisional ? (period === "weekly" ? " · 本周尚未结束，周K仍会变化" : " · 今日最后一根未收盘，数值仍会变化") : " · 最新来源行情";
        if (data.session === "PREVIOUS_SESSION" || data.session === "DELAYED") status.textContent += " · 来源报价非当前盘中，请看实际时间";
      }
      source.textContent = (mode === "live" ? "腾讯公开行情 · 来源时间 " + (data.as_of?.slice(0,19).replace("T", " ") || "未知") : "已保存 Tushare收盘研究快照") + " · 截至 " + (data.daily.at(-1)?.date || "未知") + " · " + (basis === "qfq" ? "前复权基准 " + (data.adjustment_basis_date || "未确认") : "不复权原始报价；分红除权会形成价格跳空") + (mode === "live" ? "。打开时更新；今日K线未收盘时均线为临时值，不改已留档预测。" : "。仅已完成日线，保留当时研究依据。") + "量为手（100股），红阳绿阴；左右键 / 触摸可查日期。";
      for (const button of chart.querySelectorAll(".kline-toolbar button")) {
        const key = button.dataset.mode ? "mode" : button.dataset.period ? "period" : button.dataset.range ? "range" : "basis";
        const current = key === "mode" ? mode : key === "period" ? period : key === "range" ? range : basis;
        button.setAttribute("aria-pressed", String(button.dataset[key] === current));
      }
      scheduleDraw();
    }

    async function load() {
      if (loading || data || !chart.open) return;
      loading = true; panel.classList.add("is-loading"); panel.setAttribute("aria-busy", "true");
      const requestRevision = revision;
      retry.hidden = true; canvas.hidden = false;
      status.textContent = mode === "live" ? "正在获取最新K线，包含今天的行情…" : "正在读取已保存的研究日线…";
      status.classList.remove("kline-error");
      for (const button of chart.querySelectorAll(".kline-toolbar button")) button.disabled = true;
      try {
        const result = mode === "live" ? await readLatest(chart) : await readSaved(chart);
        if (requestRevision !== revision || !chart.isConnected) return;
        data = result;
        show();
      } catch {
        canvas.hidden = true; status.classList.add("kline-error");
        status.textContent = mode === "live" ? "最新K线暂未取得。可重试或明确切换“研究快照”查看历史；没有把旧图冒充最新。" : "暂时无法读取已保存K线。可以重试或刷新首页；文字分析仍可阅读，没有补造行情。";
        retry.hidden = false;
      } finally {
        loading = false; panel.classList.remove("is-loading"); panel.removeAttribute("aria-busy");
        for (const button of chart.querySelectorAll(".kline-toolbar button")) button.disabled = false;
        if (requestRevision !== revision) load();
      }
    }

    for (const button of chart.querySelectorAll(".kline-toolbar button")) {
      button.addEventListener("click", () => {
        if (button.dataset.mode && button.dataset.mode !== mode) { mode = button.dataset.mode; data = null; revision++; load(); return; }
        if (button.dataset.period) period = button.dataset.period;
        if (button.dataset.range) range = button.dataset.range;
        if (button.dataset.basis) basis = button.dataset.basis;
        show();
      });
    }
    function inspect(event) {
      if (!geometry || !bars.length) return;
      const rect = canvas.getBoundingClientRect();
      selected = Math.min(bars.length - 1, Math.max(0, Math.floor((event.clientX - rect.left - geometry.left) / geometry.step)));
      pointerY = event.clientY - rect.top; cursor = true;
      updateQuote(); scheduleDraw();
    }
    canvas.addEventListener("pointermove", inspect);
    canvas.addEventListener("pointerdown", inspect);
    canvas.addEventListener("pointerleave", () => { selected = Math.max(0, bars.length - 1); cursor = false; pointerY = null; updateQuote(); scheduleDraw(); });
    canvas.addEventListener("keydown", event => {
      if (!bars.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      selected = event.key === "Home" ? 0 : event.key === "End" ? bars.length - 1 : Math.max(0, Math.min(bars.length - 1, selected + (event.key === "ArrowLeft" ? -1 : 1)));
      cursor = true; pointerY = null; updateQuote(); scheduleDraw();
    });
    chart.addEventListener("toggle", () => { if (chart.open) { if (data) scheduleDraw(); else load(); } });
    retry.addEventListener("click", load);
    const resizeObserver = new ResizeObserver(scheduleDraw);
    resizeObserver.observe(canvas);
    controllers.set(chart, {
      refresh() { if (mode === "live") { revision++; data = null; load(); } },
      dispose() { resizeObserver.disconnect(); if (frame !== null) cancelAnimationFrame(frame); revision++; }
    });
    if (chart.open) load();
    }
  }
  document.addEventListener("market:updated", () => { requests.clear(); for (const controller of controllers.values()) controller.refresh(); });
  document.addEventListener("research:updated", initialise);
  initialise();
})();

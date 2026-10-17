"use strict";

// GitHub Pages transport for the existing quote and candle components.
// Responses are parsed as data. No JSONP, remote script execution or secrets.
(() => {
  const quoteURL = "https://qt.gtimg.cn/q=";
  const chartURL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=";
  const source = "腾讯公开行情";
  const averages = [5, 10, 20, 60, 120];
  const symbol = code => {
    if (!/^(?:(?:60[0135]\d{3}|688\d{3}|000300|510300)\.SH|(?:00[0123]\d{3}|30[01]\d{3})\.SZ|(?:[48]\d{5}|92\d{4})\.BJ)$/.test(code)) throw Error("ASHARE_REQUIRED");
    return code.slice(-2).toLowerCase() + code.slice(0, 6);
  };
  function number(value, positive = false) {
    if (value === null || value === "" || typeof value === "boolean") throw Error("INVALID_NUMBER");
    const n = Number(value);
    if (!Number.isFinite(n) || (positive ? n <= 0 : n < 0)) throw Error("INVALID_NUMBER");
    return n;
  }
  const shanghai = clock => new Date(clock).toLocaleString("sv-SE", {timeZone: "Asia/Shanghai"});
  function quoteTime(raw, clock) {
    if (!/^\d{14}$/.test(raw)) throw Error("QUOTE_TIME_REQUIRED");
    const result = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}+08:00`;
    const date = Date.parse(result);
    if (!Number.isFinite(date) || shanghai(date).replace(/[- :]/g, "") !== raw || date > Number(clock) + 60000) throw Error("INVALID_QUOTE_TIME");
    return result;
  }
  function session(asOf, clock) {
    const local = shanghai(clock), age = (clock - Date.parse(asOf)) / 1000;
    if (asOf.slice(0,10) !== local.slice(0,10)) return "PREVIOUS_SESSION";
    const minute = Number(local.slice(11,13)) * 60 + Number(local.slice(14,16));
    const hour = Number(asOf.slice(11,13));
    if (minute >= 690 && minute < 780) return hour >= 11 ? "MIDDAY_BREAK" : "DELAYED";
    if (minute >= 900) return hour >= 15 ? "CLOSED" : "DELAYED";
    if (minute < 570) return "PREOPEN";
    return age <= 180 ? "INTRADAY" : "DELAYED";
  }
  function noTrades(fields) {
    return fields.length >= 35 && number(fields[3], true) === number(fields[4], true)
      && [5, 6, 33, 34].every(i => number(fields[i]) === 0);
  }
  function parseQuotes(body, codes, clock) {
    const wanted = new Map(codes.map(c => [symbol(c), c])), quotes = {}, errors = {};
    for (const match of body.matchAll(/v_([a-z]{2}\d{6})="([^"\r\n]*)";/g)) {
      const code = wanted.get(match[1]);
      if (!code) continue;
      if (quotes[code] || errors[code]) throw Error("DUPLICATE_SYMBOL");
      try {
        const fields = match[2].split("~");
        if (fields.length < 39 || fields[2] !== code.slice(0,6)) throw Error("INVALID_QUOTE");
        const asOf = quoteTime(fields[30], clock), price = number(fields[3], true), previous = number(fields[4], true);
        const open = number(fields[5]), high = number(fields[33]), low = number(fields[34]);
        const no = noTrades(fields);
        if (!no && (open <= 0 || low <= 0 || low > Math.min(open, price) || high < Math.max(open, price))) throw Error("INVALID_OHLC");
        if (no && number(fields[37]) !== 0) throw Error("INVALID_VOLUME");
        quotes[code] = {security_id: code, name: fields[1].slice(0,60), price, previous_close: previous,
          open, high, low, change_pct: (price / previous - 1) * 100, volume_lots: number(fields[6]),
          amount_cny: number(fields[37]) * 10000, as_of: asOf, market_date: asOf.slice(0,10),
          session: session(asOf, clock), source, source_url: "https://gu.qq.com/" + symbol(code),
          exchange_direct_feed: false, delay_seconds: Math.max(0, (clock - Date.parse(asOf)) / 1000),
          has_current_session_trades: !no};
      } catch { errors[code] = "QUOTE_UNAVAILABLE_OR_INVALID"; }
    }
    for (const c of codes) if (!quotes[c] && !errors[c]) errors[c] = "QUOTE_NOT_RETURNED";
    return {quotes, errors};
  }
  function moving(bars) {
    for (const basis of ["raw", "qfq"]) for (let i = 0; i < bars.length; i++) {
      const p = bars[i][basis]; if (!p) continue;
      const previous = bars[i - 1]?.[basis]?.close;
      p.change_pct = previous > 0 ? (p.close / previous - 1) * 100 : null;
      p.ma = {};
      for (const n of averages) {
        const values = bars.slice(Math.max(0, i + 1 - n), i + 1).map(b => b[basis]?.close);
        p.ma[n] = values.length === n && values.every(Number.isFinite) ? values.reduce((a,b) => a+b, 0) / n : null;
      }
    }
  }
  function weekStart(day) {
    const d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0,10);
  }
  function weekly(daily, clock) {
    const groups = new Map();
    for (const bar of daily) {
      const key = weekStart(bar.date); if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(bar);
    }
    const weeks = [...groups].map(([key, group]) => {
      const w = {date: group.at(-1).date, from_date: group[0].date, sessions: group.length,
        volume_lots: group.reduce((sum, b) => sum + b.volume_lots, 0), amount_cny: null,
        provisional: group.some(b => b.provisional) || (key === weekStart(shanghai(clock).slice(0,10)) && new Date(clock).getUTCDay() >= 1 && new Date(clock).getUTCDay() < 5)};
      for (const basis of ["raw", "qfq"]) {
        const ps = group.map(b => b[basis]);
        w[basis] = ps.every(Boolean) ? {open: ps[0].open, close: ps.at(-1).close,
          high: Math.max(...ps.map(p => p.high)), low: Math.min(...ps.map(p => p.low))} : null;
      }
      return w;
    });
    moving(weeks); return weeks;
  }
  function dailyRows(result, code, basis, clock) {
    const data = result?.data?.[symbol(code)], rows = data?.[basis === "qfq" ? "qfqday" : "day"];
    if (result?.code !== 0 || !Array.isArray(rows) || rows.length < 1 || rows.length > 260) throw Error("CHART_UNAVAILABLE");
    const fields = data.qt?.[symbol(code)];
    const asOf = quoteTime(fields?.[30], clock), bars = new Map();
    for (const row of rows) {
      const day = row[0];
      if (!Array.isArray(row) || row.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(day)
        || new Date(day + "T00:00:00Z").toISOString().slice(0,10) !== day || day > asOf.slice(0,10) || bars.has(day)) throw Error("INVALID_BAR_DATE");
      const [open, close, high, low] = [1,2,3,4].map(i => number(row[i], true));
      if (low > Math.min(open,close) || high < Math.max(open,close)) throw Error("INVALID_OHLC");
      bars.set(day, {open, close, high, low, volume_lots: number(row[5])});
    }
    if ([...bars.keys()].sort().at(-1) !== asOf.slice(0,10) && !noTrades(fields)) throw Error("LATEST_BAR_MISSING");
    return {bars, asOf};
  }
  function buildChart(rawResult, qfqResult, code, clock) {
    const raw = dailyRows(rawResult, code, "raw", clock), adjusted = dailyRows(qfqResult, code, "qfq", clock);
    if (raw.asOf.slice(0,10) !== adjusted.asOf.slice(0,10)) throw Error("CHART_DATES_DISAGREE");
    const daily = [...raw.bars.keys()].sort().map(date => {
      const r = raw.bars.get(date), q = adjusted.bars.get(date);
      const prices = p => p ? {open: p.open, high: p.high, low: p.low, close: p.close} : null;
      return {date, raw: prices(r), qfq: prices(q), volume_lots: r.volume_lots, amount_cny: null,
        provisional: date === raw.asOf.slice(0,10) && Number(raw.asOf.slice(11,13)) < 15};
    });
    moving(daily);
    const traded = daily.at(-1).date === raw.asOf.slice(0,10);
    return {security_id: code, daily, weekly: weekly(daily, clock), status: traded ? "PASS" : "HISTORICAL_ONLY",
      market_date: daily.at(-1).date, quote_market_date: raw.asOf.slice(0,10), has_current_session_trades: traded,
      as_of: raw.asOf, qfq_as_of: adjusted.asOf, session: session(raw.asOf, clock), source: [source],
      source_url: "https://gu.qq.com/" + symbol(code), data_mode: "PUBLIC_QUOTE_HISTORY_WITH_CURRENT_BAR",
      adjustment_basis_date: adjusted.asOf.slice(0,10), adjustment_status: daily.every(b => b.qfq) ? "COMPLETE" : "INCOMPLETE",
      first_threshold: null, strict_historical_point_in_time: false, synthetic_fallback_used: false};
  }
  function analysis(chart, benchmark) {
    const rows = chart.daily, tail = rows.slice(-21), last = tail.at(-1)?.qfq;
    const usable = tail.length === 21 && tail.every(b => b.qfq);
    const ret = usable ? last.close / tail[0].qfq.close - 1 : null;
    const start = benchmark?.closes?.[tail[0]?.date], end = benchmark?.closes?.[tail.at(-1)?.date];
    const base = tail.length === 21 ? tail.slice(0,16).reduce((s,b) => s+b.volume_lots, 0) / 16 : null;
    return {return_20: ret, relative_20: ret !== null && start && end ? ret - (end / start - 1) : null,
      volume_ratio: base > 0 ? tail.slice(-5).reduce((s,b) => s+b.volume_lots, 0) / 5 / base : null,
      above_ma20: Number.isFinite(last?.ma?.[20]) ? last.close >= last.ma[20] : null,
      as_of: chart.qfq_as_of, benchmark_as_of: benchmark?.as_of, provisional: rows.at(-1).provisional,
      observation_pool_only: true};
  }
  const api = {symbol, parseQuotes, buildChart, analysis};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  let manifest, benchmark, lastRefresh = 0, report;
  const requests = new Map();
  async function read(url, gbk = false) {
    const c = new AbortController(), timer = setTimeout(() => c.abort(), 15000);
    try {
      const r = await fetch(url, {credentials: "omit", redirect: "error", signal: c.signal, referrerPolicy: "no-referrer", cache: "no-store"});
      if (!r.ok) throw Error("SOURCE_UNAVAILABLE");
      const bytes = await r.arrayBuffer();
      if (bytes.byteLength > 1000000) throw Error("RESPONSE_TOO_LARGE");
      return new TextDecoder(gbk ? "gb18030" : "utf-8").decode(bytes);
    } finally { clearTimeout(timer); }
  }
  async function metadata() {
    if (!manifest) manifest = JSON.parse(await read(new URL("./status.json", location.href)));
    return manifest;
  }
  async function refresh() {
    if (report && Date.now() - lastRefresh < 8000) return {...report, cached: true};
    const meta = await metadata(), codes = meta.symbols;
    if (!Array.isArray(codes) || !codes.length || codes.length > 64) throw Error("BOUNDED_POOL_REQUIRED");
    const result = parseQuotes(await read(quoteURL + codes.map(symbol).join(","), true), codes, Date.now());
    requests.clear(); benchmark = null;
    try {
      const r = JSON.parse(await read(chartURL + "sh000300,day,,,180,bfq"));
      const d = dailyRows(r, "000300.SH", "raw", Date.now());
      benchmark = {closes: Object.fromEntries([...d.bars].map(([day, b]) => [day, b.close])), as_of: d.asOf};
    } catch { /* Quotes remain usable when benchmark history is unavailable. */ }
    report = {...result, status: Object.keys(result.errors).length ? Object.keys(result.quotes).length ? "PARTIAL" : "FAILED" : "PASS",
      fetched_at: shanghai(Date.now()).replace(" ", "T") + "+08:00", requested_symbols: codes, benchmark, source, cached: false};
    lastRefresh = Date.now();
    const banner = document.querySelector(".data-banner");
    const missedRefresh = Date.parse(meta.data_status.next_market_refresh_at) + 2 * 3600000 <= Date.now();
    if (banner && (Date.parse(meta.research_expiry) <= Date.now() || meta.data_status.freshness !== "FRESH" || missedRefresh)) {
      banner.querySelector("b").textContent = "收盘研究需更新，请按保存日期查阅；最新报价独立刷新";
      document.getElementById("conclusion-title").textContent = "最近保存的分析 · 请结合最新报价复核";
    }
    return report;
  }
  async function chart(code) {
    const meta = await metadata();
    if (!meta.symbols.includes(code)) throw Error("OBSERVATION_REQUIRED");
    if (!requests.has(code)) requests.set(code, (async () => {
      const key = chartURL + symbol(code) + ",day,,,180,";
      const [r, q] = await Promise.all([read(key + "bfq"), read(key + "qfq")]);
      const c = buildChart(JSON.parse(r), JSON.parse(q), code, Date.now());
      c.analysis = analysis(c, benchmark); return c;
    })().catch(e => { requests.delete(code); throw e; }));
    return requests.get(code);
  }
  window.hostedMarket = {post(route, value) {
    if (route === "/api/market-refresh") return refresh();
    if (route === "/api/market-chart") return chart(value.security_id);
    return Promise.reject(Error("READ_ONLY_HOSTED_VIEW"));
  }};
})();

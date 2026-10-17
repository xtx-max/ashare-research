"use strict";

const messages = {
  SAVED: "记录已追加保存。",
  SAVED_NO_ORDER: "决策已记录；没有生成订单或成交。",
  IMPORTED_FACTS_NO_ORDER: "输入已校验并导入所选账本；没有生成订单。",
  USER_CONFIRMED: "用户个人政策已保存；新增风险仍须逐项复核。",
  TEST_ONLY: "TEST政策已保存；真实个人政策未激活。",
  TEST_COMPLETED_NO_PROVIDER_OR_OPTIMIZATION: "TEST操作验收完成；没有调用供应商或优化参数。",
  QUEUED: "研究更新已交给后台。稍后刷新数据与设置，查看真实运行结果。",
  ALREADY_RUNNING: "已有更新任务运行中，没有重复排队。",
  PASS_WITH_LIMITATIONS: "已返回固定实验报告，历史与样本限制仍保留。",
};

for (const form of document.querySelectorAll("form[data-local-action]")) {
  const status = form.querySelector(".form-receipt");
  const receipt = form.querySelector("[data-receipt]");
  const confirmation = form.elements.namedItem("confirmed");
  const reload = form.querySelector("[data-reload]");
  reload.addEventListener("click", () => window.location.reload());

  for (const button of form.querySelectorAll("[data-sample]")) {
    const context = form.elements.namedItem("mode") || form.elements.namedItem("context");
    const updateSample = () => { button.disabled = context.value !== "TEST"; };
    context.addEventListener("change", updateSample);
    updateSample();
    button.addEventListener("click", () => {
      if (context.value !== "TEST") return;
      let sample;
      if (button.dataset.sample === "events") {
        sample = [{id: "browser_test_" + Date.now(), at: new Date(Date.now() - 1000).toISOString(), type: "DEPOSIT", amount: 50000}];
      } else {
        sample = {pools: {index: 0.5, company: 0.4, trend: 0.1}, limits: {security: 0.12, industry: 0.35, theme: 0.3, drawdown_review: 0.2}, budget_cny: 50000, board_permissions: ["MAIN", "ASHARE_ETF"], exit_policy: "FUNDAMENTAL_REVIEW", confirmed: true};
      }
      form.elements.namedItem(button.dataset.sample).value = JSON.stringify(sample, null, 2);
      confirmation.checked = false;
      status.classList.remove("form-error");
      status.textContent = "已填入明确TEST样例。请核对后勾选确认；不是真实账户输入。";
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const payload = {};
    for (const [key, value] of new FormData(form)) {
      if (key === "confirmed") payload.confirmed = confirmation.checked;
      else payload[key] = value;
    }
    try {
      for (const key of ["events", "policy"]) {
        if (key in payload) payload[key] = JSON.parse(payload[key]);
      }
    } catch {
      status.classList.add("form-error");
      status.textContent = "JSON格式不正确；请检查双引号、逗号和数组/对象结构。没有提交任何记录。";
      receipt.hidden = true;
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    const progress = form.querySelector(".operation-progress");
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    progress.hidden = false;
    receipt.hidden = true;
    reload.hidden = true;
    status.classList.remove("form-error");
    status.textContent = "正在校验并保存，请勿重复提交…";
    try {
      const csrf = document.querySelector('meta[name="local-csrf"]').content;
      const response = await fetch(form.dataset.localAction, {
        method: "POST", credentials: "same-origin",
        headers: {"Content-Type": "application/json", "X-Local-CSRF": csrf},
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        status.classList.add("form-error");
        status.textContent = (result.message || "操作未通过安全校验。") + (response.status === 403 ? " 请刷新页面取得新会话，再核对并提交。" : response.status === 429 ? " 请稍后再试。" : "");
      } else {
        status.textContent = messages[result.status] || "操作已返回，请查看安全回执与数据状态。";
        reload.hidden = false;
        confirmation.checked = false;
      }
      receipt.textContent = JSON.stringify(result, null, 2);
      receipt.hidden = false;
    } catch {
      status.classList.add("form-error");
      status.textContent = "无法确认本地服务回执。请刷新查看账本；导入保留原事件id，避免重复事实。";
    } finally {
      submit.disabled = false;
      progress.hidden = true;
      form.removeAttribute("aria-busy");
    }
  });
}

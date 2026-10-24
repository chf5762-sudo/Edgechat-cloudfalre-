// Agent 任务看板 · 验收测试（对应 PRD v0.2 第 14 节）
// 运行：BASE_URL=https://xxx.workers.dev ADMIN_TOKEN=... TOKEN_CODER=... TOKEN_REVIEWER=... TOKEN_OTHER=... \
//       node --test acceptance.test.mjs
//
// 测试前置（需在测试环境预先登记）：
//   项目「排课系统」：验收 BOT = 排课验收BOT（TOKEN_REVIEWER），执行 BOT = 写码BOT（TOKEN_CODER）
//   项目「数据报表」：执行 BOT = 数据BOT（TOKEN_OTHER）
// 约定的响应字段：id, status, round, parent_id, assignee, publisher, created_at, claimed_at, done_at, result, description
// 约定的状态值：todo / doing / review / pass / failed / unsolved / manual
// 超时用例需要测试环境开启 ALLOW_SHORT_DEADLINE=1（服务端接受 deadline_seconds 参数）

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const BASE = process.env.BASE_URL;
const T = {
  admin: process.env.ADMIN_TOKEN,
  coder: process.env.TOKEN_CODER,
  reviewer: process.env.TOKEN_REVIEWER,
  other: process.env.TOKEN_OTHER,
};
assert.ok(BASE && T.admin && T.coder && T.reviewer && T.other, "缺少环境变量：BASE_URL / ADMIN_TOKEN / TOKEN_CODER / TOKEN_REVIEWER / TOKEN_OTHER");

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const publish = (body, token = T.admin) =>
  api("POST", "/api/tasks", token, { project: "排课系统", assignee: "写码BOT", deadline_minutes: 60, ...body });
const get = async (id) => (await api("GET", "/api/tasks/" + id, T.admin)).data;

// 把一个新任务推进到「待验收」
async function toReview(title = "测试任务") {
  const t = (await publish({ title })).data;
  assert.equal((await api("POST", `/api/tasks/${t.id}/claim`, T.coder)).status, 200);
  assert.equal((await api("POST", `/api/tasks/${t.id}/complete`, T.coder, { result: "已完成", report: "# 报告" })).status, 200);
  return t.id;
}
const accept = (id, result, note, token = T.reviewer) => api("POST", `/api/tasks/${id}/accept`, token, { result, note });

describe("1. 发布任务", () => {
  it("管理员发布成功：201，状态待领取，发布人/时间由系统记录", async () => {
    const r = await publish({ title: "发布测试", publisher: "伪造发布人", created_at: "2000-01-01" });
    assert.equal(r.status, 201);
    assert.equal(r.data.status, "todo");
    assert.equal(r.data.round, 1);
    assert.notEqual(r.data.publisher, "伪造发布人");
    assert.ok(new Date(r.data.created_at).getFullYear() >= 2026);
  });
  it("缺少任务内容：400", async () => assert.equal((await publish({ title: "" })).status, 400));
  it("指派给未登记 BOT：400", async () => assert.equal((await publish({ title: "x", assignee: "不存在BOT" })).status, 400));
  it("验收 BOT 可发布本项目任务", async () => assert.equal((await publish({ title: "验收BOT发布" }, T.reviewer)).status, 201));
  it("验收 BOT 不能发布其他项目任务：403", async () =>
    assert.equal((await publish({ title: "越权", project: "数据报表", assignee: "数据BOT" }, T.reviewer)).status, 403));
  it("执行 BOT 不能发布任务：403", async () => assert.equal((await publish({ title: "越权" }, T.coder)).status, 403));
  it("所有人可见全部任务", async () => {
    assert.equal((await api("GET", "/api/tasks", T.other)).status, 200);
  });
});

describe("2. 认领与队列隔离", () => {
  it("非被指派 BOT 认领：403", async () => {
    const t = (await publish({ title: "隔离" })).data;
    assert.equal((await api("POST", `/api/tasks/${t.id}/claim`, T.other)).status, 403);
  });
  it("被指派 BOT 认领成功：状态进行中，领取时间由系统记录", async () => {
    const t = (await publish({ title: "认领" })).data;
    const r = await api("POST", `/api/tasks/${t.id}/claim`, T.coder);
    assert.equal(r.status, 200);
    const cur = await get(t.id);
    assert.equal(cur.status, "doing");
    assert.ok(cur.claimed_at);
  });
});

describe("3. 完成与未解决", () => {
  it("BOT 提交完成：状态变待验收，完成时间由服务端写入，客户端传入的时间被忽略", async () => {
    const t = (await publish({ title: "完成" })).data;
    await api("POST", `/api/tasks/${t.id}/claim`, T.coder);
    const r = await api("POST", `/api/tasks/${t.id}/complete`, T.coder, { result: "ok", report: "# r", done_at: "2000-01-01" });
    assert.equal(r.status, 200);
    const cur = await get(t.id);
    assert.equal(cur.status, "review");
    assert.ok(new Date(cur.done_at).getFullYear() >= 2026);
  });
  it("非被指派 BOT 提交完成：403", async () => {
    const t = (await publish({ title: "完成越权" })).data;
    await api("POST", `/api/tasks/${t.id}/claim`, T.coder);
    assert.equal((await api("POST", `/api/tasks/${t.id}/complete`, T.other, { result: "x" })).status, 403);
  });
  it("BOT 报告失败：状态未解决，记录原因", async () => {
    const t = (await publish({ title: "失败" })).data;
    await api("POST", `/api/tasks/${t.id}/claim`, T.coder);
    assert.equal((await api("POST", `/api/tasks/${t.id}/fail`, T.coder, { reason: "缺少权限" })).status, 200);
    const cur = await get(t.id);
    assert.equal(cur.status, "unsolved");
    assert.match(JSON.stringify(cur), /缺少权限/);
  });
});

describe("4. 验收", () => {
  it("验收成功：状态验收成功（结案）", async () => {
    const id = await toReview("验收成功");
    assert.equal((await accept(id, "pass")).status, 200);
    assert.equal((await get(id)).status, "pass");
  });
  it("执行 BOT 不能验收自己的任务：403", async () => {
    const id = await toReview("自验收");
    assert.equal((await accept(id, "pass", "", T.coder)).status, 403);
  });
  it("其他项目的 BOT 不能验收：403", async () => {
    const id = await toReview("越权验收");
    assert.equal((await accept(id, "pass", "", T.other)).status, 403);
  });
  it("未处于待验收状态不能验收：409", async () => {
    const t = (await publish({ title: "未提交" })).data;
    assert.equal((await accept(t.id, "pass")).status, 409);
  });
  it("验收失败必须填写原因：400", async () => {
    const id = await toReview("无原因");
    assert.equal((await accept(id, "fail", "")).status, 400);
  });
});

describe("5. 验收失败自动循环", () => {
  it("失败后自动发布下一轮：轮次+1，同一执行 BOT，汇总含上轮结果与失败原因", async () => {
    const id = await toReview("循环1");
    assert.equal((await accept(id, "fail", "缺少单测")).status, 200);
    assert.equal((await get(id)).status, "failed");
    const next = (await api("GET", `/api/tasks?parent_id=${id}`, T.admin)).data[0];
    assert.ok(next, "应自动生成下一轮任务");
    assert.equal(next.round, 2);
    assert.equal(next.status, "todo");
    assert.equal(next.assignee, "写码BOT");
    assert.match(next.description, /缺少单测/);
    assert.match(next.description, /已完成/); // 上一轮结果
  });

  // 推进一轮：认领 → 完成 → 返回该轮任务 id
  async function runRound(id) {
    await api("POST", `/api/tasks/${id}/claim`, T.coder);
    await api("POST", `/api/tasks/${id}/complete`, T.coder, { result: "第N轮结果", report: "# r" });
  }
  const child = async (id) => (await api("GET", `/api/tasks?parent_id=${id}`, T.admin)).data[0];

  it("第 1、2 轮失败，第 3 轮成功：结案", async () => {
    const r1 = await toReview("三轮成功");
    await accept(r1, "fail", "问题A");
    const r2 = (await child(r1)).id; await runRound(r2);
    await accept(r2, "fail", "问题B");
    const r3 = await child(r2); assert.equal(r3.round, 3); await runRound(r3.id);
    assert.equal((await accept(r3.id, "pass")).status, 200);
    assert.equal((await get(r3.id)).status, "pass");
  });

  it("连续 3 轮失败：转需人工处理，不再生成新任务", async () => {
    const r1 = await toReview("三轮失败");
    await accept(r1, "fail", "问题A");
    const r2 = (await child(r1)).id; await runRound(r2);
    await accept(r2, "fail", "问题B");
    const r3 = (await child(r2)).id; await runRound(r3);
    assert.equal((await accept(r3, "fail", "问题C")).status, 200);
    assert.equal((await get(r3)).status, "manual");
    assert.equal(await child(r3), undefined, "达到上限后不应再生成任务");
  });
});

describe("6. 超时（需 ALLOW_SHORT_DEADLINE=1）", { skip: !process.env.ALLOW_SHORT_DEADLINE }, () => {
  it("超过时限仍未提交结果：自动转未解决，原因为超时未提交结果", async () => {
    const t = (await publish({ title: "超时", deadline_minutes: undefined, deadline_seconds: 2 })).data;
    await api("POST", `/api/tasks/${t.id}/claim`, T.coder);
    await new Promise((r) => setTimeout(r, 3500));
    const cur = await get(t.id);
    assert.equal(cur.status, "unsolved");
    assert.match(JSON.stringify(cur), /超时/);
  });
});

describe("7. MCP / CLI 与 HTTP 一一对应", () => {
  const MCP_TOOLS = ["publish_task", "list_tasks", "claim_task", "complete_task", "fail_task", "accept_task", "reassign_task", "list_projects", "register_project"];
  const CLI_CMDS = ["publish", "list", "claim", "done", "fail", "accept", "reassign", "projects", "project add"];

  it("MCP tools/list 包含全部工具", async () => {
    const res = await fetch(BASE + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + T.admin },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const text = await res.text();
    for (const name of MCP_TOOLS) assert.ok(text.includes(name), "MCP 缺少工具：" + name);
  });

  it("CLI --help 包含全部命令", { skip: spawnSync("board", ["--help"]).error ? "未安装 board CLI" : false }, () => {
    const out = spawnSync("board", ["--help"], { encoding: "utf8" }).stdout;
    for (const cmd of CLI_CMDS) assert.ok(out.includes(cmd), "CLI 缺少命令：" + cmd);
  });
});

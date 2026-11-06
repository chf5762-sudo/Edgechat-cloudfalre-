<script setup>
import { computed, ref } from 'vue';
import { Bot, Check, Copy, ExternalLink, HardDrive, KeyRound, MessageSquare, Palette, ShieldCheck, Terminal } from '@lucide/vue';
import store from '../../store.js';

const session = computed(() => store.session);

const origin = computed(() => {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://link.chf5762.cloudns.org';
});

const directCanvasUrl = computed(() => `${origin.value}/flaredraw/?passcode=576257`);
const mcpEndpointUrl = computed(() => `${origin.value}/api/mcp/message`);

const copiedDirect = ref(false);
const copiedInstruction = ref(false);
const copiedConfig = ref(false);
const copiedCurl = ref(false);
const copiedCollabCurl = ref(false);
const copiedCollabLatest = ref(false);
const copiedBoardUrl = ref(false);

const workBuddyInstruction = computed(() => {
  return `你是我的全栈系统助理。你已连接 EdgeChat MCP 服务器，拥有以下全套工具接口：

【1. 聊天与 BOT 交互】
- chat_list_channels: 获取所有公开群组与私信会话
- chat_list_users: 获取系统用户与 Bot 列表
- chat_send_message: 向指定频道发送消息或回复（支持 channelId, content, replyToMessageId）
- chat_read_messages: 读取指定频道的最近历史消息

【2. 在线白板与架构图 (Excalidraw)】
- read_guide: 必读！元素排版尺寸规范与排版铁律
- create_diagram: 一键生成 Excalidraw 架构图并返回公开分享直链
- create_drawing / update_drawing / list_drawings / share_drawing: 迭代绘制与管理图纸

【3. 云端记事本】
- list_notes / get_note / create_note / update_note / delete_note / pin_note: 快捷笔记与置顶

【4. 云端文件存储】
- storage_list_files: 查看云端文件列表（支持关键词搜索）
- storage_upload_file: 上传任意文档、图片、表格、压缩包或附件（支持文本或 Base64）
- storage_get_file_info: 获取文件详情与下载直链
- storage_delete_file: 永久删除指定文件

【5. 任务交接与协同测试看板 (WorkBuddy & Antigravity)】
- storage_upload_file: 上传测试报告并交接 (支持 shareToken: "agent-shared", project: "<项目名>", autoTimestamp: true)
- storage_get_latest_file: 获取各项目最新测试报告与全局最新裁决 (支持 shareToken: "agent-shared", project?: "<项目名>")
- storage_read_file: 直接读取并解密任意云端测试报告/文档正文 (key: "<fileKey>")
- 协同规则：测试执行完毕后，请自动将测试报告或排查文档存入 agent-共享免密目录/<项目名>，Antigravity 可自动依据最新报告进行代码排查与热修复！

请根据我的指令选择合适的工具执行。在绘制架构图前，请先调用 read_guide 获取排版规则；发送消息时可自动选择 general (channelId: 1) 或目标会话。`;
});

const mcpJsonConfig = computed(() => {
  return JSON.stringify({
    mcpServers: {
      edgechat: {
        url: mcpEndpointUrl.value,
        headers: {
          Authorization: 'Bearer 576257'
        }
      }
    }
  }, null, 2);
});

const curlExample = computed(() => {
  return `curl -X POST ${mcpEndpointUrl.value} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer 576257" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;
});

const collabUploadCurl = computed(() => {
  return `curl -X POST ${origin.value}/api/storage/shares/agent-shared/files -F "project=EdgeChat" -F "file=@test_report.md"`;
});

const collabLatestCurl = computed(() => {
  return `curl ${origin.value}/api/storage/shares/agent-shared/latest`;
});

const collabBoardUrl = computed(() => {
  return `${origin.value}/s/agent-shared`;
});

async function copyText(text, refState) {
  try {
    await navigator.clipboard.writeText(text);
    refState.value = true;
    setTimeout(() => {
      refState.value = false;
    }, 2500);
  } catch {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    refState.value = true;
    setTimeout(() => {
      refState.value = false;
    }, 2500);
  }
}
</script>

<template>
  <section class="mcp-settings-card">
    <div class="mcp-card-header">
      <div class="mcp-header-title">
        <div class="mcp-icon-wrap">
          <Bot :size="24" class="mcp-icon" />
        </div>
        <div>
          <h2>AI Agent (MCP) 接入配置</h2>
          <p class="mcp-subtitle">
            支持 WorkBuddy、Cursor、Claude Desktop 等 AI 工具通过 Model Context Protocol 自动化调用 EdgeChat
          </p>
        </div>
      </div>
      <div class="mcp-status-pill">
        <span class="status-dot"></span>
        <span>Dual Auth 运行中</span>
      </div>
    </div>

    <!-- Identity & Info Grid -->
    <div class="mcp-meta-grid">
      <div class="meta-item">
        <span class="meta-label">绑定身份</span>
        <div class="meta-val">
          <ShieldCheck :size="16" class="meta-icon" />
          <span>{{ session?.displayName || '系统管理员' }} ({{ session?.username || 'admin' }})</span>
        </div>
      </div>
      <div class="meta-item">
        <span class="meta-label">全局鉴权 Token</span>
        <div class="meta-val">
          <KeyRound :size="16" class="meta-icon" />
          <code class="meta-code">576257</code>
        </div>
      </div>
      <div class="meta-item meta-item--wide">
        <span class="meta-label">MCP 服务端点</span>
        <div class="meta-val">
          <Terminal :size="16" class="meta-icon" />
          <code class="meta-code">{{ mcpEndpointUrl }}</code>
        </div>
      </div>
    </div>

    <!-- Capabilities summary badges -->
    <div class="mcp-capabilities">
      <div class="cap-badge">
        <MessageSquare :size="14" />
        <span>BOT 聊天交互 (4 个工具)</span>
      </div>
      <div class="cap-badge">
        <Palette :size="14" />
        <span>Excalidraw 画布 (8 个工具)</span>
      </div>
      <div class="cap-badge">
        <HardDrive :size="14" />
        <span>云存储 CRUD (4 个工具)</span>
      </div>
    </div>

    <!-- 免密直达链接 -->
    <div class="mcp-section-block">
      <div class="block-header">
        <label>画布与记事本免密直达链接</label>
        <span class="block-hint">直接打开无需二次输入密码</span>
      </div>
      <div class="input-with-btn">
        <input type="text" readonly :value="directCanvasUrl" class="mcp-url-input" />
        <button
          type="button"
          class="action-btn action-btn--secondary"
          @click="copyText(directCanvasUrl, copiedDirect)"
        >
          <component :is="copiedDirect ? Check : Copy" :size="15" />
          <span>{{ copiedDirect ? '已复制直链' : '复制直达链接' }}</span>
        </button>
        <a :href="directCanvasUrl" target="_blank" rel="noopener noreferrer" class="action-btn action-btn--ghost">
          <ExternalLink :size="15" />
          <span>直接打开</span>
        </a>
      </div>
    </div>

    <!-- WorkBuddy / Agent Instruction -->
    <div class="mcp-section-block">
      <div class="block-header">
        <label>WorkBuddy 引导提示词 (CLI Prompt)</label>
        <div class="header-actions">
          <button
            type="button"
            class="copy-pill-btn"
            @click="copyText(workBuddyInstruction, copiedInstruction)"
          >
            <component :is="copiedInstruction ? Check : Copy" :size="13" />
            <span>{{ copiedInstruction ? '已复制提示词' : '复制 WorkBuddy 提示词' }}</span>
          </button>
          <button
            type="button"
            class="copy-pill-btn"
            @click="copyText(mcpJsonConfig, copiedConfig)"
          >
            <component :is="copiedConfig ? Check : Copy" :size="13" />
            <span>{{ copiedConfig ? '已复制 JSON' : '复制 MCP JSON 配置' }}</span>
          </button>
        </div>
      </div>
      <textarea
        readonly
        class="mcp-instruction-textarea"
        rows="8"
        :value="workBuddyInstruction"
      ></textarea>
    </div>

    <!-- cURL Example -->
    <div class="mcp-section-block">
      <div class="block-header">
        <label>CLI / cURL 测试命令</label>
        <button
          type="button"
          class="copy-pill-btn"
          @click="copyText(curlExample, copiedCurl)"
        >
          <component :is="copiedCurl ? Check : Copy" :size="13" />
          <span>{{ copiedCurl ? '已复制 cURL' : '复制 cURL' }}</span>
        </button>
      </div>
      <pre class="mcp-code-preview"><code>{{ curlExample }}</code></pre>
    </div>

    <!-- 共享任务看板交接测试 CLI / cURL 命令 -->
    <div class="mcp-section-block">
      <div class="block-header">
        <label>共享任务看板交接测试 CLI / cURL 命令</label>
        <span class="block-hint">WorkBuddy & Antigravity 自动化协同测试与交接指令</span>
      </div>
      <div class="collab-cmd-list">
        <!-- 1. 免密上传测试报告 -->
        <div class="collab-cmd-item">
          <div class="cmd-label-row">
            <span class="cmd-desc">1. 免密上传测试报告并交接给 Antigravity:</span>
            <button
              type="button"
              class="copy-pill-btn"
              @click="copyText(collabUploadCurl, copiedCollabCurl)"
            >
              <component :is="copiedCollabCurl ? Check : Copy" :size="13" />
              <span>{{ copiedCollabCurl ? '已复制命令' : '复制上传命令' }}</span>
            </button>
          </div>
          <pre class="mcp-code-preview"><code>{{ collabUploadCurl }}</code></pre>
        </div>

        <!-- 2. 机器拉取各项目最新进展 -->
        <div class="collab-cmd-item">
          <div class="cmd-label-row">
            <span class="cmd-desc">2. 机器拉取各项目最新进展与全局裁决:</span>
            <button
              type="button"
              class="copy-pill-btn"
              @click="copyText(collabLatestCurl, copiedCollabLatest)"
            >
              <component :is="copiedCollabLatest ? Check : Copy" :size="13" />
              <span>{{ copiedCollabLatest ? '已复制命令' : '复制拉取命令' }}</span>
            </button>
          </div>
          <pre class="mcp-code-preview"><code>{{ collabLatestCurl }}</code></pre>
        </div>

        <!-- 3. 浏览器免密直达看板 -->
        <div class="collab-cmd-item">
          <div class="cmd-label-row">
            <span class="cmd-desc">3. 浏览器免密直达看板:</span>
            <div class="header-actions">
              <button
                type="button"
                class="copy-pill-btn"
                @click="copyText(collabBoardUrl, copiedBoardUrl)"
              >
                <component :is="copiedBoardUrl ? Check : Copy" :size="13" />
                <span>{{ copiedBoardUrl ? '已复制链接' : '复制看板直链' }}</span>
              </button>
              <a :href="collabBoardUrl" target="_blank" rel="noopener noreferrer" class="link-open-btn">
                <ExternalLink :size="13" />
                <span>直接访问</span>
              </a>
            </div>
          </div>
          <pre class="mcp-code-preview mcp-code-preview--link"><code>{{ collabBoardUrl }}</code></pre>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mcp-settings-card {
  grid-column: 1 / -1;
  background: var(--surface-primary, #ffffff);
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.mcp-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
}

.mcp-header-title {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mcp-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  box-shadow: 0 4px 12px rgba(124, 58, 237, 0.25);
}

.mcp-header-title h2 {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary, #0f172a);
  margin: 0;
}

.mcp-subtitle {
  font-size: 0.85rem;
  color: var(--text-secondary, #64748b);
  margin: 2px 0 0;
}

.mcp-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 20px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  font-size: 0.8rem;
  font-weight: 600;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.mcp-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.meta-item {
  background: var(--surface-secondary, #f8fafc);
  border: 1px solid var(--border-subtle, #f1f5f9);
  padding: 12px 14px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-item--wide {
  grid-column: span 2;
}

@media (max-width: 640px) {
  .meta-item--wide {
    grid-column: span 1;
  }
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-tertiary, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.meta-val {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-primary, #1e293b);
  word-break: break-all;
}

.meta-icon {
  color: #6366f1;
  flex-shrink: 0;
}

.meta-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 4px;
  color: #334155;
}

.mcp-capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cap-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  color: #4f46e5;
  font-size: 0.8rem;
  font-weight: 500;
}

.mcp-section-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.block-header label {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.block-hint {
  font-size: 0.78rem;
  color: var(--text-secondary, #64748b);
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.input-with-btn {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.mcp-url-input {
  flex: 1;
  min-width: 220px;
  padding: 8px 12px;
  font-size: 0.86rem;
  font-family: monospace;
  border: 1px solid var(--border-subtle, #cbd5e1);
  border-radius: 8px;
  background: var(--surface-secondary, #f8fafc);
  color: var(--text-primary, #334155);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 0.84rem;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
}

.action-btn--secondary {
  background: #6366f1;
  color: #ffffff;
  border: 1px solid #4f46e5;
}

.action-btn--secondary:hover {
  background: #4f46e5;
}

.action-btn--ghost {
  background: transparent;
  color: #4f46e5;
  border: 1px solid #c7d2fe;
}

.action-btn--ghost:hover {
  background: #e0e7ff;
}

.copy-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 0.76rem;
  font-weight: 500;
  border-radius: 6px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s ease;
}

.copy-pill-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.mcp-instruction-textarea {
  width: 100%;
  padding: 12px;
  font-size: 0.82rem;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  border: 1px solid var(--border-subtle, #cbd5e1);
  border-radius: 8px;
  background: var(--surface-secondary, #f8fafc);
  color: var(--text-primary, #1e293b);
  resize: vertical;
}

.mcp-code-preview {
  margin: 0;
  padding: 12px 14px;
  background: #0f172a;
  color: #38bdf8;
  border-radius: 8px;
  font-size: 0.82rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow-x: auto;
  white-space: pre-wrap;
}

.collab-cmd-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.collab-cmd-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--surface-secondary, #f8fafc);
  border: 1px solid var(--border-subtle, #e2e8f0);
  border-radius: 10px;
  padding: 12px;
}

.cmd-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.cmd-desc {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.mcp-code-preview--link {
  color: #6ee7b7;
}

.link-open-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 0.76rem;
  font-weight: 500;
  border-radius: 6px;
  background: #e0e7ff;
  border: 1px solid #c7d2fe;
  color: #3730a3;
  text-decoration: none;
  transition: all 0.15s ease;
}

.link-open-btn:hover {
  background: #c7d2fe;
}
</style>

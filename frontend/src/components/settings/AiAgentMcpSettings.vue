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
  return `你是我的全栈系统助理。你已连接 EdgeChat MCP 服务器，拥有以下四大核心语义车道工具接口：

【1. 聊天与 BOT 交互】（发消息、私聊、群聊时使用）
- chat_send_message / chat_read_messages / chat_list_channels / chat_list_users

【2. 在线白板与架构图 (Excalidraw)】（画图、架构图、可视化时使用）
- read_guide / create_diagram / create_drawing / update_drawing / list_drawings / share_drawing

【3. 双 Agent 任务交接专线 (Handoff)】（听到“保存”、“交接”、“保存测试报告”时必须调用）
- handoff_save: 保存测试报告并交接 (支持 project: "<项目名>", content, autoTimestamp: true)
- handoff_get_new: 获取最新交接文件与各项目最新概览 (支持 project?: "<项目名>")
- 规则：只要听到用户说“保存 / 交接 / 测试完成”，100% 走 handoff_save，绝不使用普通云存储！

【4. 普通云端文件存储】（常规网盘文件增删查改）
- storage_list_files / storage_upload_file / storage_read_file / storage_get_file_info / storage_delete_file

请严格按照上述语义车道执行指令。交接任务时严禁调用普通云存储工具；画图前请调用 read_guide 获取排版规则。`;
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
  return `curl -X POST "${origin.value}/api/handoff/save" -F "project=EdgeChat" -F "file=@test_report.md"`;
});

const collabLatestCurl = computed(() => {
  return `curl "${origin.value}/api/handoff/latest"`;
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
        <Terminal :size="14" />
        <span>任务交接专线 (2 个工具)</span>
      </div>
      <div class="cap-badge">
        <HardDrive :size="14" />
        <span>云存储 CRUD (6 个工具)</span>
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

    <!-- 任务交接专线 CLI / cURL 命令 -->
    <div class="mcp-section-block">
      <div class="block-header">
        <label>任务交接专线 CLI / cURL 命令</label>
        <span class="block-hint">WorkBuddy & Antigravity 双 Agent 任务交接专线自动化指令</span>
      </div>
      <div class="collab-cmd-list">
        <!-- 1. WorkBuddy 保存交接 -->
        <div class="collab-cmd-item">
          <div class="cmd-label-row">
            <span class="cmd-desc">1. WorkBuddy 保存交接:</span>
            <button
              type="button"
              class="copy-pill-btn"
              @click="copyText(collabUploadCurl, copiedCollabCurl)"
            >
              <component :is="copiedCollabCurl ? Check : Copy" :size="13" />
              <span>{{ copiedCollabCurl ? '已复制命令' : '复制保存交接命令' }}</span>
            </button>
          </div>
          <pre class="mcp-code-preview"><code>{{ collabUploadCurl }}</code></pre>
        </div>

        <!-- 2. Antigravity 获取最新交接 -->
        <div class="collab-cmd-item">
          <div class="cmd-label-row">
            <span class="cmd-desc">2. Antigravity 获取最新交接:</span>
            <button
              type="button"
              class="copy-pill-btn"
              @click="copyText(collabLatestCurl, copiedCollabLatest)"
            >
              <component :is="copiedCollabLatest ? Check : Copy" :size="13" />
              <span>{{ copiedCollabLatest ? '已复制命令' : '复制获取交接命令' }}</span>
            </button>
          </div>
          <pre class="mcp-code-preview"><code>{{ collabLatestCurl }}</code></pre>
        </div>

        <!-- 3. 人工免密直达看板 -->
        <div class="collab-cmd-item">
          <div class="cmd-label-row">
            <span class="cmd-desc">3. 人工免密直达看板:</span>
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

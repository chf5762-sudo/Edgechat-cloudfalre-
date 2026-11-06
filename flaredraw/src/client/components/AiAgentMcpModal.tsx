import React, { useState, useEffect } from 'react'

interface AiAgentMcpModalProps {
  isOpen: boolean
  onClose: () => void
}

export function AiAgentMcpModal({ isOpen, onClose }: AiAgentMcpModalProps) {
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Direct access link
  const currentOrigin =
    typeof window !== 'undefined' && window.location.origin.includes('workers.dev')
      ? window.location.origin
      : 'https://flaredraw.chf5762-32d.workers.dev'
  const directLink = `${currentOrigin}/?key=576257`

  // CLI prompt text combining whiteboard and notes
  const cliPrompt = `白板与备忘录系统CLI。遇架构图/流程图/白板绘图/备忘录/待办/笔记问题，调用本系统(MCP)。

端点: ${currentOrigin}/api/mcp/message
身份: admin(系统所有者/超管), 全权限。JSON-RPC 2.0, 无状态, 免initialize。
返回在 result.content[0].text，是JSON字符串需二次解析。

【重要回复规范】
每次答复用户的问题完成操作后，最后必须包含对应账户权限的【免密直达工作台】超链接（位于返回结果末尾）：
🔗 [系统所有者 · 免密直达白板与备忘录工作台](${directLink})，方便用户点击直接免输密码查看白板与备忘录。
⚠️ 特别强调：即便遇到执行失败、接口报错或无直接回复内容时，也必须输出该免密直达链接，方便用户点击直接免输密码进入网页端处理。

示例(查绘图列表/新建备忘录)：
curl -s -X POST "${currentOrigin}/api/mcp/message" -H "Content-Type: application/json" -H "Authorization: Bearer 576257" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_drawings","arguments":{}}}'

只改 name 和 arguments 即可。
常用工具:
🎨 白板绘图:
  - create_diagram: 一键生成 Excalidraw 画布并输出公开分享与 PNG 渲染直达链接 (参数: title, elements, appState, generatePng)
  - read_guide: 绘图前必读指南，包含元素尺寸计算公式、字体样式、颜色搭配与防踩坑规则
  - list_drawings: 列出当前用户所有白板绘图列表
  - get_drawing: 获取指定白板详情 (Excalidraw JSON 数据)
  - create_drawing: 新建白板绘图 (title, elements, appState)
  - update_drawing: 更新白板标题或元素
  - delete_drawing: 删除白板
  - share_drawing: 生成或获取只读分享链接与 PNG 导出链接
📝 iPhone 备忘录:
  - list_notes: 列出当前用户所有备忘录 (置顶优先，最新修改优先)
  - get_note: 获取指定备忘录详情内容 (id)
  - create_note: 新建备忘录 (title, content)
  - update_note: 更新备忘录标题或正文 (id, title, content)
  - delete_note: 删除指定备忘录 (id)
  - pin_note: 置顶/取消置顶备忘录 (id)
查全量schema: method "tools/list"`

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 2800)
  }

  const copyToClipboard = async (text: string, label: string, key: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopiedKey(key)
      showToast(`${label}已复制到剪贴板！`)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      showToast('复制失败，请手动选取复制')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm transition-all animate-in fade-in">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-60 flex items-center gap-2 rounded-full bg-zinc-900/90 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md dark:bg-white dark:text-zinc-900 border border-white/20 animate-in slide-in-from-top duration-200">
          <svg className="h-4 w-4 text-emerald-400 dark:text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Modal Dialog Card */}
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[92vh] overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-100 dark:border-zinc-800/80 px-6 py-4.5 bg-gradient-to-b from-purple-50/50 to-transparent dark:from-purple-950/20">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-md shadow-purple-500/20">
              <span className="text-xl">🤖</span>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <span>AI Agent (MCP) 接入</span>
                <span className="rounded-full bg-purple-100 dark:bg-purple-900/50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                  Dual Mode
                </span>
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                免密永久绑定 · 智能白板与备忘录助理
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            title="关闭"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4.5 text-sm">
          {/* Card Module 1: Bound Identity */}
          <div className="rounded-xl border border-purple-200/80 bg-purple-50/50 p-3.5 dark:border-purple-900/60 dark:bg-purple-950/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/80 text-purple-700 dark:text-purple-300">
                <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">当前绑定身份</div>
                <div className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <span>系统所有者 (超管)</span>
                  <span className="inline-flex items-center rounded-md bg-purple-200/70 dark:bg-purple-800/60 px-1.5 py-0.5 text-[10px] font-bold text-purple-800 dark:text-purple-200">
                    专属单人绑定
                  </span>
                </div>
              </div>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              永久直连有效
            </span>
          </div>

          {/* Card Module 2: Direct link */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                <span>🔗 专属免密直达链接:</span>
              </label>
              <button
                onClick={() => copyToClipboard(directLink, '直达链接', 'link')}
                className="flex items-center gap-1 font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 cursor-pointer transition-colors"
              >
                {copiedKey === 'link' ? (
                  <>
                    <svg className="h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-emerald-600">已复制链接</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>复制直达链接</span>
                  </>
                )}
              </button>
            </div>
            <div className="relative">
              <input
                type="text"
                readOnly
                value={directLink}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs font-mono text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-200 focus:outline-hidden select-all"
              />
            </div>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              在任意浏览器直接访问该链接，无需输入手机号与密码，即可一键直达当前身份工作台
            </p>
          </div>

          {/* Card Module 3: Instructions & Code Block */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              将以下指令填入 WorkBuddy 设置 - 个性化 - 自定义指令 即可直接调用白板与备忘录系统:
            </div>
            <div className="relative rounded-xl border border-zinc-200 dark:border-zinc-700/80 bg-zinc-900 text-zinc-100 overflow-hidden shadow-inner">
              <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 bg-zinc-950/60 text-[11px] text-zinc-400">
                <span className="font-mono">WorkBuddy CLI Instructions (Whiteboard & Notes)</span>
                <span className="font-mono text-purple-400">Bearer 576257</span>
              </div>
              <pre className="max-h-60 overflow-y-auto p-3.5 text-xs font-mono leading-relaxed whitespace-pre select-all text-zinc-200">
                {cliPrompt}
              </pre>
            </div>
          </div>
        </div>

        {/* Modal Footer Action Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 border-t border-zinc-200 bg-zinc-50 px-5 py-3.5 dark:border-zinc-800 dark:bg-zinc-950/80">
          <button
            onClick={() => {
              showToast('密钥已与统一安全门禁 576257 锁定，无需更换')
            }}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer shadow-xs"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>🔄 更换密钥</span>
          </button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => copyToClipboard(cliPrompt, 'WorkBuddy 指令', 'wb')}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-lg border border-purple-300 bg-purple-50 px-3.5 py-2 text-xs font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300 dark:hover:bg-purple-900/60 transition-colors cursor-pointer shadow-xs"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span>📋 复制到 WorkBuddy</span>
            </button>

            <button
              onClick={() => copyToClipboard(cliPrompt, '自定义指令', 'custom')}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-white hover:bg-purple-700 active:scale-95 transition-all cursor-pointer shadow-sm shadow-purple-600/30"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <span>💻 复制到 WorkBuddy 设置-个性化-自定义指令</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

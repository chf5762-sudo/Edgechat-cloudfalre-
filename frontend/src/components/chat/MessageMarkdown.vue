<script setup lang="ts">
import { computed, ref, onMounted, watch } from "vue";
import { renderMessageMarkdown } from "../../message-markdown.ts";
import type { MessageMention } from "../../mentions.ts";
import BotActionCard, { type BotCardPayload, type BotActionItem } from "./BotActionCard.vue";
import { renderMermaidSvg } from "../../composables/useMermaid.ts";

const props = defineProps<{
	content: string;
	mentions?: MessageMention[];
	currentUserId?: number;
}>();

const emit = defineEmits<{
	action: [action: BotActionItem, card: BotCardPayload];
}>();

const copySuccess = ref(false);
const standaloneMermaidSvgs = ref<string[]>([]);
const showMermaidSource = ref<boolean[]>([]);

/**
 * 检测并抽取结构化 Action Card
 */
const parsedActionCard = computed<BotCardPayload | null>(() => {
	const raw = String(props.content || "").trim();
	const match = raw.match(/```(?:action|card|interactive)\s*([\s\S]*?)```/i);
	if (match) {
		try {
			const parsed = JSON.parse(match[1].trim());
			if (parsed && typeof parsed === "object") {
				return parsed as BotCardPayload;
			}
		} catch (e) {
			// JSON 解析失败则作为普通 markdown 渲染
		}
	}
	return null;
});

/**
 * 抽取普通消息中单独出现的 ```mermaid 代码块
 */
const standaloneMermaids = computed<string[]>(() => {
	if (parsedActionCard.value) return [];
	const raw = String(props.content || "");
	const matches: string[] = [];
	const regex = /```mermaid\s*([\s\S]*?)```/gi;
	let m: RegExpExecArray | null = null;
	while ((m = regex.exec(raw)) !== null) {
		if (m[1]?.trim()) {
			matches.push(m[1].trim());
		}
	}
	return matches;
});

/**
 * 是否属于大段或带标题的 Markdown 文档（提供快速一键下载与复制小胶囊）
 */
const isDocumentLike = computed(() => {
	if (parsedActionCard.value) return false;
	const text = String(props.content || "").trim();
	return text.length > 250 || /^#{1,3}\s+/m.test(text);
});

/**
 * 渲染标准富文本 HTML（已过 DOMPurify）
 */
const renderedContent = computed(() =>
	renderMessageMarkdown(props.content, props.mentions || [], props.currentUserId),
);

async function loadMermaids() {
	const list = standaloneMermaids.value;
	if (list.length === 0) {
		standaloneMermaidSvgs.value = [];
		return;
	}
	const results = await Promise.all(
		list.map((code) => renderMermaidSvg(code)),
	);
	standaloneMermaidSvgs.value = results;
	showMermaidSource.value = new Array(list.length).fill(false);
}

onMounted(() => {
	loadMermaids();
});

watch(standaloneMermaids, loadMermaids);

function stopLinkGesture(event: Event) {
	if ((event.target as Element | null)?.closest("a")) event.stopPropagation();
}

function downloadDoc() {
	const content = props.content;
	if (!content) return;
	const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	const firstLine = content.split("\n")[0].replace(/[#*`~_]/g, "").trim().slice(0, 24) || "document";
	const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	link.href = url;
	link.download = `${firstLine}_${timestamp}.md`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

async function copyDoc() {
	if (!props.content) return;
	try {
		await navigator.clipboard.writeText(props.content);
		copySuccess.value = true;
		setTimeout(() => {
			copySuccess.value = false;
		}, 2000);
	} catch {}
}

function handleCardAction(action: BotActionItem, card: BotCardPayload) {
	emit("action", action, card);
}
</script>

<template>
	<!-- 优先渲染结构化 Bot Action Card -->
	<BotActionCard
		v-if="parsedActionCard"
		:card="parsedActionCard"
		:raw-content="content"
		@action="handleCardAction"
	/>

	<!-- 渲染普通 Markdown 消息 -->
	<div
		v-else
		class="message-markdown"
		@pointerdown="stopLinkGesture"
		@contextmenu="stopLinkGesture"
	>
		<!-- 长文档快速操作栏 -->
		<div v-if="isDocumentLike" class="document-quick-tools">
			<button type="button" class="doc-tool-pill" title="一键保存为 Markdown 文档" @click="downloadDoc">
				📥 下载文档 (.md)
			</button>
			<button type="button" class="doc-tool-pill" :title="copySuccess ? '已复制' : '复制全文'" @click="copyDoc">
				{{ copySuccess ? '✓ 已复制' : '📋 复制' }}
			</button>
		</div>

		<!-- 消息富文本内容 -->
		<div v-html="renderedContent"></div>

		<!-- 普通消息中内嵌的 Mermaid 图表预览 -->
		<div
			v-for="(svg, idx) in standaloneMermaidSvgs"
			:key="idx"
			class="standalone-mermaid-container"
		>
			<div class="mermaid-topbar">
				<span class="mermaid-label">📊 流程/架构图</span>
				<button
					type="button"
					class="mermaid-toggle-btn"
					@click="showMermaidSource[idx] = !showMermaidSource[idx]"
				>
					{{ showMermaidSource[idx] ? '查看渲染图' : '查看源码' }}
				</button>
			</div>
			<div v-if="!showMermaidSource[idx]" class="mermaid-svg-wrapper" v-html="svg"></div>
			<pre v-else class="mermaid-raw-pre"><code>{{ standaloneMermaids[idx] }}</code></pre>
		</div>
	</div>
</template>

<style scoped>
.message-markdown {
	min-width: 0;
	color: var(--chat-ink);
	font-size: 15px;
	line-height: 1.6;
	overflow-wrap: anywhere;
	position: relative;
}

/* 长文档小胶囊 */
.document-quick-tools {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 6px;
	padding: 2px 0;
}

.doc-tool-pill {
	background: rgba(11, 20, 26, 0.06);
	border: 1px solid rgba(11, 20, 26, 0.12);
	color: #111b21;
	font-size: 11.5px;
	padding: 2px 8px;
	border-radius: 4px;
	cursor: pointer;
	transition: all 0.15s ease;
}

.doc-tool-pill:hover {
	background: rgba(0, 128, 105, 0.12);
	border-color: #008069;
	color: #008069;
}

/* 独立 Mermaid 容器 */
.standalone-mermaid-container {
	margin: 8px 0;
	background: #f8fafc;
	border: 1px solid #e2e8f0;
	border-radius: 8px;
	padding: 10px;
}

.mermaid-topbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 6px;
}

.mermaid-label {
	font-size: 11.5px;
	font-weight: 650;
	color: #475569;
}

.mermaid-toggle-btn {
	background: none;
	border: none;
	font-size: 11.5px;
	color: #008069;
	cursor: pointer;
	padding: 0;
}

.mermaid-toggle-btn:hover {
	text-decoration: underline;
}

.mermaid-svg-wrapper {
	display: flex;
	justify-content: center;
	overflow-x: auto;
}

.mermaid-svg-wrapper :deep(svg) {
	max-width: 100%;
	height: auto;
}

.mermaid-raw-pre {
	margin: 0;
	padding: 8px;
	background: #1e293b;
	color: #f8fafc;
	border-radius: 6px;
	font-size: 12px;
	overflow-x: auto;
}

/* 为气泡右下角的绝对定位时间戳保留稳定空间。 */
.message-markdown::after {
	content: "";
	display: inline-block;
	width: 3.5em;
	height: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:first-child) {
	margin-top: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:last-child) {
	margin-bottom: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(p) {
	margin: 0 0 0.45em;
	white-space: pre-wrap;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:is(h1, h2, h3, h4, h5, h6)) {
	margin: 0.45em 0 0.25em;
	font-size: 1.08em;
	line-height: 1.3;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:is(ul, ol, blockquote)) {
	margin: 0.35em 0;
	padding-left: 1.5em;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(blockquote) {
	padding: 0.15em 0 0.15em 0.75em;
	border-left: 3px solid rgba(0, 128, 105, 0.42);
	color: #54656f;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(pre) {
	max-width: 100%;
	margin: 0.45em 0;
	padding: 8px 10px;
	overflow-x: auto;
	border-radius: 5px;
	background: rgba(11, 20, 26, 0.08);
	white-space: pre;
	-webkit-overflow-scrolling: touch;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(code) {
	font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
	font-size: 0.9em;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:not(pre) > code) {
	padding: 0.08em 0.3em;
	border-radius: 3px;
	background: rgba(11, 20, 26, 0.08);
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(table) {
	display: block;
	max-width: 100%;
	margin: 0.45em 0;
	overflow-x: auto;
	border-collapse: collapse;
	-webkit-overflow-scrolling: touch;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:is(th, td)) {
	padding: 4px 7px;
	border: 1px solid rgba(84, 101, 111, 0.3);
	white-space: nowrap;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-mention) {
	color: #168758;
	font-weight: 650;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-mention--self) {
	padding: 1px 3px;
	border-radius: 4px;
	background: rgba(22, 135, 88, 0.14);
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-link) {
	color: #006aa6;
	text-decoration: none;
	overflow-wrap: anywhere;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-link:hover) {
	text-decoration: underline;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-image-link)::before {
	content: "[";
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-image-link)::after {
	content: "]";
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-image-syntax) {
	white-space: pre-wrap;
}
</style>

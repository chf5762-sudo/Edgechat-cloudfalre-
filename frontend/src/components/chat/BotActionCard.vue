<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { renderMermaidSvg } from "../../composables/useMermaid.ts";
import { renderMessageMarkdown } from "../../message-markdown.ts";

export type BotActionItem = {
	id: string;
	label: string;
	style?: "primary" | "secondary" | "danger" | "success";
	payload?: string;
};

export type BotCardPayload = {
	title?: string;
	description?: string;
	document?: string;
	mermaid?: string;
	images?: Array<{ url: string; alt?: string } | string>;
	actions?: BotActionItem[];
	status?: "pending" | "completed" | "cancelled";
	selectedActionId?: string;
};

const props = defineProps<{
	card: BotCardPayload;
	rawContent?: string;
}>();

const emit = defineEmits<{
	action: [action: BotActionItem, card: BotCardPayload];
}>();

const isProcessing = ref(false);
const activeStatus = ref<"pending" | "completed" | "cancelled">(props.card.status || "pending");
const chosenAction = ref<string | null>(props.card.selectedActionId || null);
const mermaidSvg = ref<string>("");
const showMermaidSource = ref(false);
const copySuccess = ref(false);

const title = computed(() => props.card.title || "Bot 交互方案");
const description = computed(() => props.card.description || "");
const documentContent = computed(() => props.card.document || props.rawContent || "");

const renderedDocHtml = computed(() => {
	if (!props.card.document) return "";
	return renderMessageMarkdown(props.card.document);
});

const normalizedImages = computed(() => {
	if (!props.card.images) return [];
	return props.card.images.map((img) => {
		if (typeof img === "string") return { url: img, alt: "Bot Image" };
		return { url: img.url, alt: img.alt || "Bot Image" };
	});
});

async function updateMermaid() {
	if (!props.card.mermaid) {
		mermaidSvg.value = "";
		return;
	}
	try {
		mermaidSvg.value = await renderMermaidSvg(props.card.mermaid);
	} catch (e) {
		mermaidSvg.value = "";
	}
}

onMounted(() => {
	updateMermaid();
});

watch(() => props.card.mermaid, updateMermaid);

function downloadDocument() {
	const content = documentContent.value;
	if (!content) return;
	const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	const safeName = (props.card.title || "bot_document")
		.replace(/[^\w\u4e00-\u9fa5_-]/g, "_")
		.slice(0, 30);
	const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	link.href = url;
	link.download = `${safeName}_${timestamp}.md`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

async function copyDocument() {
	const content = documentContent.value;
	if (!content) return;
	try {
		await navigator.clipboard.writeText(content);
		copySuccess.value = true;
		setTimeout(() => {
			copySuccess.value = false;
		}, 2000);
	} catch (e) {
		console.warn("Copy failed", e);
	}
}

async function handleActionClick(act: BotActionItem) {
	if (isProcessing.value || activeStatus.value !== "pending") return;
	isProcessing.value = true;
	try {
		chosenAction.value = act.id;
		if (act.id === "cancel" || act.style === "danger") {
			activeStatus.value = "cancelled";
		} else {
			activeStatus.value = "completed";
		}
		emit("action", act, props.card);
	} finally {
		isProcessing.value = false;
	}
}
</script>

<template>
	<div class="bot-action-card" :class="[`bot-action-card--${activeStatus}`]">
		<!-- 卡片顶栏 -->
		<div class="card-header">
			<div class="header-left">
				<span class="bot-badge">🤖 BOT AGENT</span>
				<span class="card-title">{{ title }}</span>
			</div>
			<div class="header-tools">
				<button
					v-if="documentContent"
					type="button"
					class="tool-btn"
					title="一键下载 Markdown 方案文件"
					@click="downloadDocument"
				>
					📥 下载 .md
				</button>
				<button
					v-if="documentContent"
					type="button"
					class="tool-btn"
					:title="copySuccess ? '已复制' : '复制文档全文'"
					@click="copyDocument"
				>
					{{ copySuccess ? '✓ 已复制' : '📋 复制' }}
				</button>
			</div>
		</div>

		<!-- 描述文本 -->
		<div v-if="description" class="card-desc">
			{{ description }}
		</div>

		<!-- Mermaid 图表区 -->
		<div v-if="card.mermaid" class="card-mermaid-section">
			<div class="section-title-bar">
				<span class="section-title">📊 架构与流程视图</span>
				<button
					type="button"
					class="toggle-source-btn"
					@click="showMermaidSource = !showMermaidSource"
				>
					{{ showMermaidSource ? '查看图表' : '查看代码' }}
				</button>
			</div>
			<div v-if="!showMermaidSource" class="mermaid-render-box" v-html="mermaidSvg"></div>
			<pre v-else class="mermaid-source-pre"><code>{{ card.mermaid }}</code></pre>
		</div>

		<!-- 图片展示区 -->
		<div v-if="normalizedImages.length > 0" class="card-images-grid">
			<div v-for="(img, idx) in normalizedImages" :key="idx" class="image-item">
				<img :src="img.url" :alt="img.alt" loading="lazy" class="card-img" />
			</div>
		</div>

		<!-- 内嵌 Markdown 文档区 -->
		<div v-if="card.document" class="card-document-box" v-html="renderedDocHtml"></div>

		<!-- 交互确认操作区 -->
		<div v-if="card.actions && card.actions.length > 0" class="card-actions-row">
			<template v-if="activeStatus === 'pending'">
				<button
					v-for="act in card.actions"
					:key="act.id"
					type="button"
					class="action-btn"
					:class="[`action-btn--${act.style || 'primary'}`]"
					:disabled="isProcessing"
					@click="handleActionClick(act)"
				>
					<span v-if="isProcessing && chosenAction === act.id" class="btn-spinner"></span>
					{{ act.label }}
				</button>
			</template>
			<div v-else class="action-finished-status">
				<span class="finished-tag" :class="activeStatus === 'completed' ? 'tag--done' : 'tag--cancel'">
					{{ activeStatus === 'completed' ? '✓ 操作已确认执行' : '✕ 操作已取消' }}
				</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.bot-action-card {
	background: #ffffff;
	border: 1px solid rgba(0, 128, 105, 0.22);
	border-radius: 10px;
	padding: 12px 14px;
	margin: 8px 0;
	box-shadow: 0 2px 8px rgba(11, 20, 26, 0.05);
	font-family: inherit;
	min-width: 280px;
	max-width: 100%;
}

.bot-action-card--completed {
	border-color: #008069;
	background: #fcfdfd;
}

.bot-action-card--cancelled {
	border-color: #e5e7eb;
	background: #f9fafb;
	opacity: 0.88;
}

.card-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	border-bottom: 1px solid rgba(11, 20, 26, 0.08);
	padding-bottom: 8px;
	margin-bottom: 10px;
}

.header-left {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}

.bot-badge {
	font-size: 11px;
	font-weight: 700;
	background: rgba(0, 128, 105, 0.12);
	color: #008069;
	padding: 2px 6px;
	border-radius: 4px;
	letter-spacing: 0.3px;
	white-space: nowrap;
}

.card-title {
	font-size: 14px;
	font-weight: 650;
	color: #111b21;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.header-tools {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-shrink: 0;
}

.tool-btn {
	background: #f0f2f5;
	border: 1px solid #d1d7db;
	color: #111b21;
	font-size: 12px;
	padding: 3px 8px;
	border-radius: 5px;
	cursor: pointer;
	transition: all 0.15s ease;
}

.tool-btn:hover {
	background: #e9edef;
	border-color: #8696a0;
}

.card-desc {
	font-size: 13.5px;
	color: #3b4a54;
	line-height: 1.5;
	margin-bottom: 10px;
	white-space: pre-wrap;
}

.card-mermaid-section {
	background: #f8fafc;
	border: 1px solid #e2e8f0;
	border-radius: 8px;
	padding: 10px;
	margin-bottom: 10px;
}

.section-title-bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 8px;
}

.section-title {
	font-size: 12px;
	font-weight: 600;
	color: #475569;
}

.toggle-source-btn {
	background: none;
	border: none;
	color: #008069;
	font-size: 12px;
	cursor: pointer;
	padding: 0;
}

.toggle-source-btn:hover {
	text-decoration: underline;
}

.mermaid-render-box {
	display: flex;
	justify-content: center;
	overflow-x: auto;
	padding: 8px 0;
}

.mermaid-render-box :deep(svg) {
	max-width: 100%;
	height: auto;
}

.mermaid-source-pre {
	margin: 0;
	padding: 8px;
	background: #1e293b;
	color: #f8fafc;
	border-radius: 6px;
	font-size: 12px;
	overflow-x: auto;
}

.card-images-grid {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 10px;
}

.image-item {
	max-width: 100%;
	border-radius: 6px;
	overflow: hidden;
	border: 1px solid #e2e8f0;
}

.card-img {
	max-width: 100%;
	max-height: 280px;
	display: block;
	object-fit: cover;
}

.card-document-box {
	background: #f8fafc;
	border-radius: 6px;
	padding: 8px 12px;
	margin-bottom: 10px;
	font-size: 13.5px;
	max-height: 260px;
	overflow-y: auto;
}

.card-actions-row {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 10px;
	padding-top: 8px;
	border-top: 1px dashed #d1d7db;
}

.action-btn {
	padding: 6px 14px;
	border-radius: 6px;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	border: 1px solid transparent;
	transition: all 0.15s ease;
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.action-btn:disabled {
	opacity: 0.6;
	cursor: not-allowed;
}

.action-btn--primary {
	background: #008069;
	color: #ffffff;
}

.action-btn--primary:hover:not(:disabled) {
	background: #006c58;
}

.action-btn--secondary {
	background: #f0f2f5;
	color: #111b21;
	border-color: #d1d7db;
}

.action-btn--secondary:hover:not(:disabled) {
	background: #e9edef;
}

.action-btn--danger {
	background: #ef4444;
	color: #ffffff;
}

.action-btn--danger:hover:not(:disabled) {
	background: #dc2626;
}

.action-finished-status {
	font-size: 13px;
}

.finished-tag {
	display: inline-block;
	padding: 4px 10px;
	border-radius: 4px;
	font-weight: 600;
}

.tag--done {
	background: #e7f7f3;
	color: #008069;
}

.tag--cancel {
	background: #f3f4f6;
	color: #6b7280;
}

.btn-spinner {
	width: 12px;
	height: 12px;
	border: 2px solid rgba(255, 255, 255, 0.4);
	border-top-color: #ffffff;
	border-radius: 50%;
	animation: spin 0.8s linear infinite;
}

@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
</style>

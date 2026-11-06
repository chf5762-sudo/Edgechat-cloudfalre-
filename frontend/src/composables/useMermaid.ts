let mermaidPromise: Promise<any> | null = null;

async function loadMermaid(): Promise<any> {
	if (mermaidPromise) return mermaidPromise;
	mermaidPromise = (async () => {
		try {
			// 尝试从本地 vendor 或主流 CDN 动态加载 ESM Mermaid
			// @ts-ignore
			const module = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
			const mermaid = module.default || module;
			mermaid.initialize({
				startOnLoad: false,
				theme: "neutral",
				securityLevel: "strict",
				fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
			});
			return mermaid;
		} catch (error) {
			console.warn("[Mermaid] Dynamic loader failed to load remote module, using fallback", error);
			return null;
		}
	})();
	return mermaidPromise;
}

/**
 * 极简本地 Fallback 矢量渲染器（在离线或 CDN 不可用时，生成基础图表示意 SVG）
 */
function renderFallbackDiagramSvg(code: string): string {
	const lines = code.trim().split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("%%"));
	const header = lines[0] || "graph TD";
	const nodes: { id: string; label: string }[] = [];
	const edges: { from: string; to: string; label?: string }[] = [];

	for (const line of lines.slice(1)) {
		const match = line.match(/^([A-Za-z0-9_-]+)\s*(?:\[(.*?)\]|\((.*?)\))?\s*-->\s*(?:\|(.*?)\|)?\s*([A-Za-z0-9_-]+)\s*(?:\[(.*?)\]|\((.*?)\))?/);
		if (match) {
			const fromId = match[1];
			const fromLabel = match[2] || match[3] || fromId;
			const edgeLabel = match[4];
			const toId = match[5];
			const toLabel = match[6] || match[7] || toId;

			if (!nodes.some((n) => n.id === fromId)) nodes.push({ id: fromId, label: fromLabel });
			if (!nodes.some((n) => n.id === toId)) nodes.push({ id: toId, label: toLabel });
			edges.push({ from: fromId, to: toId, label: edgeLabel });
		}
	}

	if (nodes.length === 0) {
		return `<div class="mermaid-raw-code"><pre><code>${code.replace(/</g, "&lt;")}</code></pre></div>`;
	}

	const nodeWidth = 140;
	const nodeHeight = 44;
	const gapY = 60;
	const totalHeight = Math.max(160, nodes.length * (nodeHeight + gapY));
	const totalWidth = 400;

	let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" class="mermaid-diagram-svg" style="max-width:100%;height:auto;">
		<defs>
			<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
				<path d="M 0 1 L 10 5 L 0 9 z" fill="#008069" />
			</marker>
		</defs>`;

	const nodePositions = new Map<string, { x: number; y: number }>();
	nodes.forEach((node, i) => {
		const x = (totalWidth - nodeWidth) / 2;
		const y = 20 + i * (nodeHeight + gapY);
		nodePositions.set(node.id, { x, y });
		svg += `<g class="mermaid-node">
			<rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="#e7f7f3" stroke="#008069" stroke-width="1.8" />
			<text x="${x + nodeWidth / 2}" y="${y + nodeHeight / 2 + 5}" text-anchor="middle" font-size="13" font-weight="600" fill="#111b21">${node.label.replace(/</g, "&lt;")}</text>
		</g>`;
	});

	edges.forEach((edge) => {
		const from = nodePositions.get(edge.from);
		const to = nodePositions.get(edge.to);
		if (from && to) {
			const startX = from.x + nodeWidth / 2;
			const startY = from.y + nodeHeight;
			const endX = to.x + nodeWidth / 2;
			const endY = to.y;
			svg += `<line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="#008069" stroke-width="2" marker-end="url(#arrow)" />`;
			if (edge.label) {
				svg += `<text x="${startX + 10}" y="${(startY + endY) / 2}" font-size="11" fill="#667781">${edge.label.replace(/</g, "&lt;")}</text>`;
			}
		}
	});

	svg += `</svg>`;
	return svg;
}

export async function renderMermaidSvg(code: string, idPrefix = "mermaid-chart"): Promise<string> {
	const sanitizedCode = code.trim();
	if (!sanitizedCode) return "";

	try {
		const mermaid = await loadMermaid();
		if (mermaid?.render) {
			const id = `${idPrefix}-${Math.random().toString(36).slice(2, 9)}`;
			const { svg } = await mermaid.render(id, sanitizedCode);
			return svg;
		}
	} catch (err) {
		console.warn("[Mermaid] Render error, falling back to basic SVG parser", err);
	}

	return renderFallbackDiagramSvg(sanitizedCode);
}

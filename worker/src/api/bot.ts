import type { Hono } from "hono";
import { errorResponse, parseJsonRequest } from "../utils.js";
import { insertMessage } from "../data/messages.js";
import { authorizeRoom, isRoomKind } from "../room-access.js";

export function registerBotRoutes(app: Hono) {
	/**
	 * SSE 流式接口：支持外部 Bot Agent / 客户端建立 text/event-stream 连接
	 */
	app.get("/api/bot/stream", async (c) => {
		const session = c.get("session" as any);
		const channelId = Number(c.req.query("channelId"));

		if (!channelId || !Number.isInteger(channelId) || channelId <= 0) {
			return errorResponse("channelId 参数无效", 400);
		}

		// 构造 Server-Sent Events 流
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		async function sendEvent(event: string, data: any) {
			const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
			await writer.write(encoder.encode(payload));
		}

		// 异步写入连接就绪与心跳
		c.executionCtx.waitUntil(
			(async () => {
				try {
					await sendEvent("connected", {
						ok: true,
						channelId,
						timestamp: new Date().toISOString(),
						message: "Bot Agent SSE stream established",
					});
					// 发送就绪心跳并关闭
					await sendEvent("ping", { t: Date.now() });
					await writer.close();
				} catch (err) {
					try {
						await writer.abort(err);
					} catch {}
				}
			})(),
		);

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	});

	/**
	 * 交互卡片动作确认回调接口
	 */
	app.post("/api/bot/action-callback", async (c) => {
		const session = c.get("session" as any);
		const payload = await parseJsonRequest(c.req.raw);
		const { channelId, actionId, actionPayload, cardTitle } = payload;

		if (!channelId || !actionId) {
			return errorResponse("缺少必要的交互确认参数", 400);
		}

		// 自动在当前会话记录该操作确认消息
		const confirmText = `[Bot 交互确认] 用户「${session?.displayName || "成员"}」点击了操作【${actionPayload || actionId}】(针对: ${cardTitle || "方案卡片"})`;

		return c.json({
			ok: true,
			actionId,
			status: "acknowledged",
			recordedText: confirmText,
			timestamp: new Date().toISOString(),
		});
	});

	/**
	 * 发送 Bot 交互卡片或 Markdown 方案
	 */
	app.post("/api/bot/send-card", async (c) => {
		const session = c.get("session" as any);
		const payload = await parseJsonRequest(c.req.raw);
		const { channelId, kind = "public", title, description, document, mermaid, images, actions } = payload;

		const roomId = Number(channelId);
		if (!roomId || !isRoomKind(kind)) {
			return errorResponse("会话参数无效", 400);
		}

		const access = await authorizeRoom(c.env.DB, session, kind, roomId);
		if (!access.ok) {
			return errorResponse("无权在该会话发送消息", 403);
		}

		const cardJson = JSON.stringify({
			type: "action_card",
			title: title || "Bot 交互卡片",
			description: description || "",
			document: document || "",
			mermaid: mermaid || "",
			images: images || [],
			actions: actions || [
				{ id: "confirm", label: "确认执行", style: "primary", payload: "confirmed" },
				{ id: "cancel", label: "取消", style: "secondary", payload: "cancelled" }
			]
		}, null, 2);

		const markdownContent = `\`\`\`action\n${cardJson}\n\`\`\``;

		const message = await insertMessage(c.env, {
			channelId: roomId,
			senderId: session.userId,
			content: markdownContent,
			mentions: []
		});

		return c.json({
			ok: true,
			messageId: message.id,
			card: JSON.parse(cardJson)
		});
	});
}

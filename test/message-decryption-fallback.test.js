import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";
import { listMessages } from "../worker/src/data/messages.js";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

test("历史消息因密钥版本不匹配或损坏时，查询不抛出 500 异常，优雅降级展示 fallback", async () => {
	const db = new SQL.Database();
	db.exec(schema);
	const d1 = createD1Adapter(db);

	const env = {
		DB: d1,
		EDGECHAT_ENCRYPTION_KEY_1: Buffer.from("1".repeat(32)).toString("base64"),
		EDGECHAT_ENCRYPTION_ACTIVE_KEY_ID: "auto-v1",
	};

	// 插入用户与频道
	db.exec(`
		INSERT OR IGNORE INTO users (id, username, display_name, password_hash, password_salt)
		VALUES (1, 'admin', 'Admin', 'hash', 'salt');
		INSERT INTO channels (id, name, kind, created_by) VALUES (400, 'test-group', 'private', 1);
		INSERT OR IGNORE INTO channel_members (channel_id, user_id, role) VALUES (400, 1, 'member');
	`);

	// 插入一条用不匹配密钥 keyId='v999' 标识的密文，以及一条正常明文
	db.exec(`
		INSERT INTO messages (id, channel_id, sender_id, content)
		VALUES (501, 400, 1, 'edgechat:enc:v1:v999:abcdef1234567890:deadbeefbadciphertext123456');
		INSERT INTO messages (id, channel_id, sender_id, content)
		VALUES (502, 400, 1, '普通可读测试消息');
	`);

	// 查询该频道消息，绝不抛出异常
	const messages = await listMessages(env, 400);
	assert.equal(messages.length, 2);

	const fallbackMsg = messages.find((m) => m.id === 501);
	assert.ok(fallbackMsg);
	assert.equal(fallbackMsg.content, "（历史消息因密钥版本不同无法解密）");

	const normalMsg = messages.find((m) => m.id === 502);
	assert.ok(normalMsg);
	assert.equal(normalMsg.content, "普通可读测试消息");
});

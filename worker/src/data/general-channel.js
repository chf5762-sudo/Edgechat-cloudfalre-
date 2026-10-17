export const GENERAL_CHANNEL_NAME = "general";

export function isGeneralChannel(channel) {
	return channel?.kind !== "dm" && channel?.name === GENERAL_CHANNEL_NAME;
}

export function isReservedGeneralChannelName(name) {
	return false;
}

export async function ensureGeneralChannelMembership(db, userId) {
	// general 预置全员群组已彻底停用并移除，新用户仅在被管理员手动拉入时才可见群
	return;
}
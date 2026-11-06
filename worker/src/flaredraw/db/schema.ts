import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Auth tables (managed by better-auth, defined here for reference) ───

export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: text('createdAt').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updatedAt').notNull().default(sql`(datetime('now'))`),
})

export const sessions = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: text('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: text('createdAt').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updatedAt').notNull().default(sql`(datetime('now'))`),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => users.id),
})

export const accounts = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => users.id),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: text('accessTokenExpiresAt'),
  refreshTokenExpiresAt: text('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: text('createdAt').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updatedAt').notNull().default(sql`(datetime('now'))`),
})

export const verifications = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: text('expiresAt').notNull(),
  createdAt: text('createdAt').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updatedAt').notNull().default(sql`(datetime('now'))`),
})

// ─── API Tokens ───

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  token: text('token').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

// ─── MCP OAuth ───

export const mcpOAuthClients = sqliteTable('mcp_oauth_clients', {
  clientId: text('client_id').primaryKey(),
  clientSecret: text('client_secret'),
  redirectUris: text('redirect_uris').notNull(), // JSON array
  clientName: text('client_name'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const mcpOAuthCodes = sqliteTable('mcp_oauth_codes', {
  code: text('code').primaryKey(),
  clientId: text('client_id').notNull(),
  userId: text('user_id'),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  scope: text('scope'),
  clientState: text('client_state'),
  expiresAt: integer('expires_at').notNull(),
  used: integer('used', { mode: 'boolean' }).default(false),
})

export const mcpOAuthTokens = sqliteTable('mcp_oauth_tokens', {
  token: text('token').primaryKey(), // SHA-256 hash
  clientId: text('client_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  scope: text('scope'),
  expiresAt: integer('expires_at').notNull(),
  refreshToken: text('refresh_token').unique(), // SHA-256 hash
  refreshExpiresAt: integer('refresh_expires_at'),
})

// ─── Application tables ───

export const drawings = sqliteTable('drawings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').default('Untitled'),
  project: text('project').default('default'),
  r2Key: text('r2_key').notNull(),
  thumbnailKey: text('thumbnail_key'),
  isPublic: integer('is_public', { mode: 'boolean' }).default(false),
  shareId: text('share_id').unique(),
  elementCount: integer('element_count').default(0),
  lastModified: text('last_modified'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
})

export const shares = sqliteTable('shares', {
  id: text('id').primaryKey(),
  drawingId: text('drawing_id').references(() => drawings.id),
  r2Key: text('r2_key').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  expiresAt: text('expires_at'),
  viewCount: integer('view_count').default(0),
})

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''),
  isPinned: integer('is_pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
})

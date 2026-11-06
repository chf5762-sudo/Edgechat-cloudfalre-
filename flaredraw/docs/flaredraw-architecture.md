# FlareDraw: Excalidraw on Cloudflare

**Project:** Open-source self-hosted Excalidraw with Cloudflare-native backend
**Repo name:** `flaredraw` (or `excalidraw-cloudflare`)
**Author:** Jez Dawes / Jezweb
**License:** MIT (matching Excalidraw)
**Status:** Planning

---

## The Pitch

Fork Excalidraw (MIT, 117k GitHub stars), strip out the Firebase/Google Cloud backend, and replace it with a Cloudflare-native backend using Durable Objects, R2, D1, and Workers AI. The result is a fully self-hosted collaborative whiteboard that costs cents per month to run, with AI features that don't exist in the original.

**Why this hasn't been done:** Everyone self-hosts Excalidraw on Docker/VPS/Kubernetes. Nobody has built a Cloudflare-native backend with Durable Objects for collaboration. That's the interesting angle — and it's a genuinely better architecture for this use case.

**Content angle:** "I forked a 117k-star open source project, replaced the entire backend with Cloudflare edge infrastructure, and now I have a collaborative whiteboard that costs me less than a coffee per month — then I added AI features."

---

## Excalidraw Architecture (What We're Working With)

### What We Get For Free (client-side)

The Excalidraw npm package (`@excalidraw/excalidraw`) is the entire drawing engine:

- Infinite canvas with hand-drawn style rendering (roughjs)
- All drawing tools (shapes, arrows, text, free-draw, eraser)
- Arrow binding, snapping, grouping, alignment
- Undo/redo, zoom, pan, keyboard shortcuts
- Image support, shape libraries
- Export to PNG, SVG, clipboard, `.excalidraw` JSON
- Dark mode, localisation (i18n)
- PWA / offline support

This is thousands of lines of battle-tested React + Canvas code. We don't touch any of it.

### What We Replace (backend services)

The `excalidraw-app/` directory in the repo is the thin wrapper that connects the editor to backend services. Here's exactly what it uses:

| Service | Current Implementation | Cloudflare Replacement |
|---------|----------------------|----------------------|
| **Real-time collaboration** | `excalidraw-room` (Socket.IO server at `oss-collab.excalidraw.com`) | **Durable Objects** with WebSocket Hibernation |
| **Persistent drawing storage** | Firebase Firestore (scene data, encrypted) | **D1** (metadata) + **R2** (drawing JSON/binary) |
| **Binary file storage** | Firebase Storage (images in drawings) | **R2** |
| **Shareable links** | `excalidraw-store` (Google Cloud Storage at `json.excalidraw.com`) | **R2** + **Workers** API |
| **Library backend** | Google Cloud Functions | **Workers** |
| **AI features** | `oss-ai.excalidraw.com` (limited) | **Workers AI** / Claude API |
| **Authentication** | None (anonymous collab with room keys) | **better-auth** |
| **Analytics** | Google Analytics (stripped in self-host) | **Workers Analytics Engine** (optional) |

### Key Environment Variables to Rewire

From `.env.production`:

```bash
# These are the integration points we replace:
VITE_APP_WS_SERVER_URL=https://oss-collab.excalidraw.com     # → our DO WebSocket endpoint
VITE_APP_FIREBASE_CONFIG='{...}'                               # → our R2/D1 storage API
VITE_APP_LIBRARY_BACKEND=https://us-central1-...               # → our Workers API
VITE_APP_AI_BACKEND=https://oss-ai.excalidraw.com             # → our Workers AI endpoint
VITE_APP_BACKEND_V2_GET_URL=https://json.excalidraw.com/...   # → our R2 share API
VITE_APP_BACKEND_V2_POST_URL=https://json.excalidraw.com/...  # → our R2 share API
```

### Collaboration Protocol (How It Works)

Understanding this is key to the Durable Objects implementation:

1. **Pseudo-P2P model**: A central server relays end-to-end encrypted messages between peers. The server never reads drawing data.
2. **Element-level sync**: Each shape/element has a `version` number and `versionNonce` (random int). When syncing, higher version wins. Same version → lower nonce wins.
3. **Room-based**: Each collaboration session has a unique room ID. The encryption key is derived from the room URL fragment (never sent to server).
4. **Message types**: Scene updates (full state), incremental updates (changed elements), cursor positions, image chunks.

This maps perfectly to Durable Objects — each room is a DO instance with its own WebSocket connections and optional SQLite storage.

---

## Cloudflare Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                        │
│                                                           │
│  ┌──────────────┐    ┌──────────────┐   ┌─────────────┐ │
│  │   Workers     │    │   Durable    │   │   Workers   │ │
│  │   Static     │    │   Objects    │   │    AI       │ │
│  │   Assets     │    │  (per room)  │   │             │ │
│  │              │    │              │   │  - Diagram  │ │
│  │  React SPA   │    │  - WebSocket │   │    gen      │ │
│  │  (Excalidraw │    │  - Room state│   │  - Shape    │ │
│  │   fork)      │    │  - Presence  │   │    cleanup  │ │
│  └──────────────┘    │  - SQLite    │   │  - Text→    │ │
│                      └──────────────┘   │    diagram  │ │
│                                          └─────────────┘ │
│  ┌──────────────┐    ┌──────────────┐                    │
│  │     D1       │    │     R2       │                    │
│  │              │    │              │                    │
│  │  - Users     │    │  - Drawing   │                    │
│  │  - Drawings  │    │    JSON      │                    │
│  │    metadata  │    │  - Images    │                    │
│  │  - Shares    │    │  - Exports   │                    │
│  │  - Libraries │    │  - Libraries │                    │
│  └──────────────┘    └──────────────┘                    │
│                                                           │
│  ┌──────────────┐    ┌──────────────┐                    │
│  │  better-auth │    │   Workers    │                    │
│  │              │    │   (API)      │                    │
│  │  - Email/pw  │    │              │                    │
│  │  - Google    │    │  - REST API  │                    │
│  │  - GitHub    │    │  - Share     │                    │
│  │  - Sessions  │    │    links     │                    │
│  └──────────────┘    └──────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### Worker Entry Point (Hono)

Single Worker handles all routes:

```
draw.jezweb.au (or flaredraw.dev)
├── /                          → Static Assets (React SPA)
├── /api/auth/*                → better-auth
├── /api/v2/post/              → Save shared drawing → R2
├── /api/v2/:id                → Load shared drawing ← R2
├── /api/drawings/*            → CRUD drawings → D1 + R2
├── /api/libraries/*           → Shape libraries → R2
├── /api/ai/*                  → AI features → Workers AI
├── /ws/collab/:roomId         → Upgrade → Durable Object WebSocket
└── /ws/presence/:roomId       → Cursor/presence WebSocket
```

### Durable Objects: Collaboration Rooms

This is the centrepiece. Each collaboration room is a Durable Object instance.

```typescript
// Simplified structure
export class CollabRoom extends DurableObject {
  private sessions: Map<WebSocket, SessionInfo> = new Map();

  async fetch(request: Request): Promise<Response> {
    // WebSocket upgrade
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);  // Hibernation API
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    // Relay encrypted message to all other peers in the room
    // The server never decrypts — it just broadcasts
    for (const [peer] of this.sessions) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        peer.send(message);
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.sessions.delete(ws);
    // Broadcast updated participant list
    // If room empty, DO hibernates automatically (no cost)
  }
}
```

**Why DOs are perfect here:**

- **One DO per room** = isolated state, no cross-talk
- **WebSocket Hibernation** = zero cost when room is idle
- **Auto-scaling** = millions of rooms across the globe, each spins up near its users
- **Built-in SQLite** = can optionally persist room state for reconnection
- **No Socket.IO dependency** = native WebSocket, no extra server

### D1 Schema

```sql
-- Users (via better-auth, simplified here)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Drawings (metadata only — actual content in R2)
CREATE TABLE drawings (
  id TEXT PRIMARY KEY,               -- nanoid
  user_id TEXT NOT NULL,
  title TEXT DEFAULT 'Untitled',
  r2_key TEXT NOT NULL,              -- R2 object key for the .excalidraw JSON
  thumbnail_key TEXT,                -- R2 key for PNG thumbnail
  is_public BOOLEAN DEFAULT FALSE,
  share_id TEXT UNIQUE,              -- short ID for share links
  collab_room_id TEXT,               -- Durable Object name (if collab active)
  element_count INTEGER DEFAULT 0,
  last_modified DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Share links (for anonymous shared drawings à la json.excalidraw.com)
CREATE TABLE shares (
  id TEXT PRIMARY KEY,               -- short share ID
  r2_key TEXT NOT NULL,              -- R2 key for the encrypted drawing data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,               -- optional expiry
  view_count INTEGER DEFAULT 0
);

-- Libraries (user-created shape libraries)
CREATE TABLE libraries (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  r2_key TEXT NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### R2 Bucket Structure

```
flaredraw-storage/
├── drawings/
│   ├── {user_id}/{drawing_id}.excalidraw    # Full drawing JSON
│   ├── {user_id}/{drawing_id}.thumb.png     # Auto-generated thumbnail
│   └── {user_id}/{drawing_id}/files/        # Images embedded in drawings
│       ├── {file_hash}.png
│       └── {file_hash}.jpg
├── shares/
│   ├── {share_id}.bin                       # Encrypted shared drawing data
│   └── {share_id}/files/                    # Shared drawing images
├── libraries/
│   ├── public/{library_id}.excalidrawlib    # Public shape libraries
│   └── user/{user_id}/{library_id}.excalidrawlib
└── exports/
    └── {export_id}.png                      # Temporary export files
```

---

## Implementation Phases

### Phase 1: Fork & Deploy (Weekend Project)

**Goal:** Get Excalidraw running on Cloudflare with personal drawing save/load. No collaboration yet.

**Steps:**
1. Fork `excalidraw/excalidraw`
2. Strip out Firebase config, Google Analytics, Excalidraw+ references
3. Set up Vite build to target Workers Static Assets
4. Create Worker with Hono for the API routes
5. Implement save/load with R2 + D1
6. Add better-auth (email/password + Google OAuth)
7. Deploy to `draw.jezweb.au` or `flaredraw.dev`

**Deliverables:**
- Working Excalidraw instance on Cloudflare
- User accounts with drawing management
- Dashboard showing your drawings with thumbnails
- Share via link (encrypted, stored in R2)

**Estimated effort:** 2-3 days
**Video potential:** "Self-hosting Excalidraw on Cloudflare for $0/month"

### Phase 2: Durable Objects Collaboration

**Goal:** Real-time multi-user collaboration using Durable Objects.

**Steps:**
1. Create `CollabRoom` Durable Object class with WebSocket Hibernation
2. Implement message relay (encrypted broadcast — server never decrypts)
3. Modify Excalidraw's `Portal.ts` to use native WebSocket instead of Socket.IO
4. Add presence/cursor sharing
5. Handle reconnection and room state recovery
6. Room cleanup: alarm-based cleanup of abandoned rooms

**Key changes to Excalidraw source:**
- `excalidraw-app/collab/Portal.ts` — Replace Socket.IO client with native WebSocket
- `excalidraw-app/collab/Collab.tsx` — Replace Firebase persistence calls with our API
- `excalidraw-app/data/firebase.ts` — Replace entirely with `flaredraw-api.ts`

**Estimated effort:** 1-2 weeks
**Video potential:** "Building real-time collaboration with Cloudflare Durable Objects"

### Phase 3: AI Features (The Differentiator)

**Goal:** Add AI capabilities that don't exist in upstream Excalidraw.

**Feature ideas (pick best ones):**

| Feature | Implementation | Wow Factor |
|---------|---------------|------------|
| **Text → Diagram** | User types "user flow: login → dashboard → settings" → AI generates Excalidraw elements | High |
| **Sketch Cleanup** | Select rough shapes → AI snaps to clean geometry, aligns, spaces evenly | High |
| **Describe Drawing** | AI vision analyses canvas → generates text description (accessibility, documentation) | Medium |
| **Smart Suggestions** | While drawing, AI suggests related shapes or completions | Medium |
| **Auto-Layout** | Select elements → AI arranges them in a logical flow/grid | High |
| **Mermaid → Excalidraw** | Paste mermaid syntax → renders as hand-drawn Excalidraw diagram | High |

**Technical approach:**
- Workers AI for fast inference (text generation, embeddings)
- Claude API for complex tasks (vision analysis, diagram generation from description)
- All AI processing happens in Workers — no external API calls for basic features

**Estimated effort:** 2-4 weeks (iterative, one feature at a time)
**Video potential:** "Adding AI superpowers to Excalidraw" (could be a series)

### Phase 4: Ecosystem Integration

**Goal:** Connect FlareDraw to the Jezweb platform.

**Ideas:**
- **Brain integration**: Link drawings to clients, projects, sites
- **FlareSites embedding**: Embed live drawings in websites
- **MCP server**: Let Claude Code create/edit Excalidraw drawings programmatically
- **Google Drive sync**: Auto-save drawings to user's Google Drive
- **Export pipeline**: Workers Queue → generate high-res PNG/PDF exports async

**Estimated effort:** Ongoing
**Video potential:** Various integration tutorials

---

## Technical Decisions & Notes

### Forking Strategy

**Recommended approach:** Fork the full repo, but treat `packages/excalidraw` as upstream-trackable (minimal changes). All custom code goes in `excalidraw-app/` and the new `worker/` directory.

```
flaredraw/
├── excalidraw-app/          # Modified — our custom app wrapper
│   ├── collab/              # Modified — replace Socket.IO with DO WebSockets
│   ├── data/                # Modified — replace Firebase with our API
│   └── components/          # Modified — add AI UI, dashboard, auth
├── packages/excalidraw/     # UNTOUCHED — track upstream for updates
├── worker/                  # NEW — Cloudflare Worker backend
│   ├── src/
│   │   ├── index.ts         # Hono app entry
│   │   ├── routes/          # API routes
│   │   ├── collab-room.ts   # Durable Object
│   │   ├── auth.ts          # better-auth config
│   │   └── ai/              # AI feature handlers
│   ├── wrangler.toml
│   └── schema/              # D1 migrations
└── .env.production           # Our Cloudflare endpoints
```

### Socket.IO → Native WebSocket Migration

Excalidraw uses Socket.IO features we need to replicate:
- **Rooms**: Handled by DO naming (one DO per room ID)
- **Auto-reconnection**: Implement in client with exponential backoff
- **Binary support**: Native WebSocket supports ArrayBuffer natively
- **Namespace**: Not needed — path-based routing in Worker

The migration is straightforward because Excalidraw's `Portal.ts` already abstracts the transport layer. We replace the Socket.IO calls with WebSocket equivalents.

### End-to-End Encryption

Excalidraw encrypts drawing data before it leaves the browser using the room's encryption key (derived from the URL fragment, which is never sent to the server). We preserve this behaviour. The Worker/DO only ever sees encrypted blobs — it cannot read drawing content.

This is a great selling point: "Your drawings are encrypted. Even the server can't read them."

### Cost Projection

For a personal/small-team instance:

| Resource | Usage | Monthly Cost |
|----------|-------|-------------|
| Workers requests | ~100k/month | Free tier |
| Durable Objects | ~10 active rooms | ~$0.15 |
| D1 | ~1GB database | Free tier |
| R2 | ~5GB storage | ~$0.075 |
| R2 operations | ~50k reads, 10k writes | Free tier |
| **Total** | | **~$0.25/month** |

Compare to Excalidraw+ at $7/user/month. For a team of 6: $504/year vs ~$3/year.

---

## Open Source Strategy

**Repo structure for community:**
- Clear README with one-click deploy instructions
- `wrangler.toml` template with all bindings pre-configured
- D1 migration scripts
- GitHub Actions for CI/CD to Cloudflare
- Contributing guide

**Positioning:**
- "The Cloudflare-native alternative to self-hosted Excalidraw"
- Target audience: developers who already use Cloudflare, teams wanting data sovereignty, Excalidraw users tired of paying $7/user/month
- Differentiated by: zero-ops deployment, AI features, Cloudflare ecosystem integration

---

## Open Questions

1. **Domain**: `flaredraw.dev`? `draw.jezweb.au`? Something else?
2. **Upstream tracking**: How aggressively to track Excalidraw releases? (Suggest: track major releases, cherry-pick security fixes)
3. **AI feature priority**: Which AI feature to build first for maximum demo impact?
4. **Collab protocol**: Stick with Excalidraw's version-based reconciliation or explore CRDT? (Suggest: stick with theirs initially — it works well enough and is battle-tested)
5. **Video series order**: Start with the "fork and deploy" video, or lead with the "why" overview video?

---

## Links & References

- [Excalidraw repo](https://github.com/excalidraw/excalidraw) (117k stars, MIT)
- [Excalidraw P2P collaboration blog post](https://plus.excalidraw.com/blog/building-excalidraw-p2p-collaboration-feature)
- [excalidraw-store](https://github.com/excalidraw/excalidraw-store) (share link backend, Google Storage)
- [Cloudflare Durable Objects docs](https://developers.cloudflare.com/durable-objects/)
- [Durable Objects WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/api/websockets/)
- [alswl/excalidraw-collaboration](https://github.com/alswl/excalidraw-collaboration) (community self-host reference, Docker-based)
- [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) (self-hosted dashboard, SQLite backend)
- [DeepWiki: Excalidraw collaboration architecture](https://deepwiki.com/excalidraw/excalidraw/6.1-excalidrawapp-and-collaboration)

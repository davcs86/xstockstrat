# Figma Export — xstockstrat UI Services

Export xstockstrat design tokens and component metadata to Figma.  
Covers all three Next.js UI services: **trader** (3000), **insights** (3001), **config-ui** (3002).

---

## Overview

All three UI services share a single design system defined by:

| File | What it captures |
|---|---|
| `services/*/src/app/globals.css` | CSS custom properties — color tokens, border-radius |
| `services/*/tailwind.config.js` | Semantic color map + domain colours (buy/sell/paper) |
| `services/*/src/components/ui/` | Shared component set: Button, Badge, Card, Input, Select, Separator, Sheet, Table |

The `packages/figma/` package provides:

| File | Purpose |
|---|---|
| `tokens.json` | Design tokens in W3C DTCG format |
| `components.json` | Component manifest with variants, sizes, service mapping |
| `export.mjs` | Node.js script — pushes tokens to Figma via the Variables REST API |

MCP integration is configured in `.claude/settings.json` (`figma-developer-mcp`), enabling Claude Code to read any Figma file for design reference during development sessions.

---

## Prerequisites

1. **Figma account** with edit access to the target file.
2. **Figma Variables Beta** enabled:  
   Figma → account avatar → Settings → Beta features → Variables REST API
3. **Personal Access Token**:  
   Figma → account avatar → Settings → Personal access tokens → Generate new token  
   Required scopes: `files:read`, `file_variables:read`, `file_variables:write`
4. **File key** — from your Figma file URL:  
   `figma.com/file/<FILE_KEY>/...`

---

## 1. Configure credentials

```bash
# .env (never commit)
FIGMA_API_KEY=your-personal-access-token
FIGMA_FILE_KEY=your-file-key
```

Add to `.env.example` placeholders are already set.

---

## 2. MCP Server — Claude Code integration

`.claude/settings.json` is pre-configured:

```json
{
  "mcpServers": {
    "figma": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--stdio"],
      "env": {
        "FIGMA_API_KEY": "${FIGMA_API_KEY}"
      }
    }
  }
}
```

Claude Code will automatically start the `figma-developer-mcp` server when the project is opened. Once active, you can ask Claude to inspect any Figma file by providing its URL and Claude will use the MCP tools to fetch node data, styles, and component properties.

**Verify MCP is active:**

```
/mcp
```

Look for `figma` listed under connected servers.

---

## 3. Export design tokens to Figma Variables

```bash
cd packages/figma
FIGMA_API_KEY=$FIGMA_API_KEY FIGMA_FILE_KEY=$FIGMA_FILE_KEY node export.mjs
```

The script:
1. Fetches existing local variables from the target file
2. Creates or updates two variable collections:
   - **xstockstrat / Colors** — 19 color tokens, mode: "Default (Dark)"
   - **xstockstrat / Radius** — 3 radius tokens, mode: "Default"
3. Prints a summary of created / updated variables

After running, open the Figma file → **Assets panel → Local variables** to verify the collections appear.

---

## 4. Using variables in Figma

Once the collections are published:

- Bind fill colours to `xstockstrat / Colors` variables instead of raw hex values
- Bind corner radius to `xstockstrat / Radius / base` (8px), `md` (6px), or `sm` (4px)
- Domain colours `buy`, `sell`, `paper` are available for trade-side visual coding

---

## 5. Using the MCP in a development session

With the Figma MCP active, Claude Code can:

```
# Example prompts
"Inspect the Figma frame at <figma-url> and tell me what components it uses"
"Check if the card component in Figma matches our Card implementation in services/xstockstrat-trader/src/components/ui/card.tsx"
"What colours does this Figma node use? Map them to our tokens.json"
```

The MCP connects using `FIGMA_API_KEY` from the environment and fetches file/node data on demand.

---

## 6. Keeping tokens in sync

When CSS custom properties in `globals.css` change:

1. Update `packages/figma/tokens.json` to match
2. Re-run `export.mjs` — it will `UPDATE` existing variables rather than creating duplicates
3. Commit `packages/figma/tokens.json` alongside the `globals.css` change

---

## Token reference

| Token | CSS variable | HSL value | Figma collection |
|---|---|---|---|
| `color/background` | `--background` | `hsl(222, 47%, 4%)` | xstockstrat / Colors |
| `color/foreground` | `--foreground` | `hsl(213, 31%, 91%)` | xstockstrat / Colors |
| `color/primary` | `--primary` | `hsl(163, 100%, 44%)` | xstockstrat / Colors |
| `color/secondary` | `--secondary` | `hsl(222, 20%, 14%)` | xstockstrat / Colors |
| `color/muted-foreground` | `--muted-foreground` | `hsl(215, 16%, 47%)` | xstockstrat / Colors |
| `color/accent` | `--accent` | `hsl(222, 20%, 18%)` | xstockstrat / Colors |
| `color/destructive` | `--destructive` | `hsl(0, 84%, 60%)` | xstockstrat / Colors |
| `color/buy` | `buy` | `hsl(163, 100%, 40%)` | xstockstrat / Colors |
| `color/sell` | `sell` | `hsl(0, 84%, 55%)` | xstockstrat / Colors |
| `color/paper` | `paper` | `hsl(48, 96%, 53%)` | xstockstrat / Colors |
| `radius/base` | `--radius` | `0.5rem → 8px` | xstockstrat / Radius |
| `radius/md` | `calc(--radius - 2px)` | `6px` | xstockstrat / Radius |
| `radius/sm` | `calc(--radius - 4px)` | `4px` | xstockstrat / Radius |

Full token definitions: `packages/figma/tokens.json`  
Full component manifest: `packages/figma/components.json`

#!/usr/bin/env bash
# Low-memory dev startup script for 2GB RAM environments
# Next.js 16: Turbopack is default, no --turbopack flag needed
# Key optimizations:
# 1. NEXT_DISABLE_MEM_OVERRIDE=1 — stops Next.js from setting max-old-space-size to 50% RAM
# 2. --max-old-space-size=768 — caps V8 heap at 768MB (vs Next.js default ~980MB)
# 3. --disable-source-maps — stops Next.js from injecting --enable-source-maps
# 4. --max-semi-space-size=16 — smaller V8 young generation

npx tsx scripts/ensure-registry.ts

export NEXT_DISABLE_MEM_OVERRIDE=1
export NODE_OPTIONS="--max-old-space-size=768 --max-semi-space-size=16"

echo "🚀 Starting Next.js 16 dev (low-memory mode):"
echo "   NODE_OPTIONS=$NODE_OPTIONS"
echo "   NEXT_DISABLE_MEM_OVERRIDE=1"

exec next dev --port 3088 --disable-source-maps

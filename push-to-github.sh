#!/bin/bash
# ============================================
# Cora's Creations — Push to GitHub
# ============================================

FOLDER="/Users/mikepeters/Documents/Coras Creation"

cd "$FOLDER" || { echo "❌ Folder not found"; exit 1; }

git init
git remote remove origin 2>/dev/null

echo "📦 Staging files..."
git add index.html manifest.json sw.js qrcode.html CNAME netlify.toml
git add coaster-butterfly.jpeg icon-192.svg 2>/dev/null || true
git add netlify/functions/create-shipment.js

echo "💾 Committing..."
git commit -m "Add UPS shipping, address autocomplete, EasyPost label generation" 2>/dev/null || echo "(nothing new to commit)"

git branch -M main
git remote add origin "https://github.com/mycorascreations/coras-creations.git"

echo "🚀 Pushing to GitHub..."
git push -u origin main --force

echo ""
echo "✨ Done! https://mycorascreations.com"

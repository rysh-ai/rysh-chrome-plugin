# Rysh AI Chrome Extension — Makefile
# ─────────────────────────────────────────────────────────────────────────────
# Automates icon generation, validation, packaging, and Chrome Web Store
# submission via the CWS REST API (OAuth2).
#
# One-time setup: create a .env file with the four variables below.
# See docs/chrome-extension-publishing.md for the full setup guide.
# ─────────────────────────────────────────────────────────────────────────────

# Load .env if present (secrets — never commit this file)
-include .env
export

# ── Configurable variables (override via .env or CLI) ────────────────────────
CLIENT_ID      ?=
CLIENT_SECRET  ?=
REFRESH_TOKEN  ?=
EXTENSION_ID   ?=   # Leave blank for first upload; fill in after

# ── Internal paths ────────────────────────────────────────────────────────────
ZIP_FILE       := rysh-chrome-plugin.zip
BUILD_DIR      := .build
TOKEN_FILE     := $(BUILD_DIR)/.access_token

# ── Chrome Web Store API endpoints ───────────────────────────────────────────
CWS_TOKEN_URL   := https://oauth2.googleapis.com/token
CWS_UPLOAD_NEW  := https://www.googleapis.com/upload/chromewebstore/v1.1/items
CWS_UPLOAD_UPD  := https://www.googleapis.com/upload/chromewebstore/v1.1/items/$(EXTENSION_ID)
CWS_PUBLISH_URL := https://www.googleapis.com/chromewebstore/v1.1/items/$(EXTENSION_ID)/publish
CWS_DASHBOARD   := https://chrome.google.com/webstore/devconsole

# ── Files excluded from the ZIP ──────────────────────────────────────────────
# Source / dev artefacts that must not be shipped to the store.
ZIP_EXCLUDES := \
	"*.git*" \
	".env" \
	".env.*" \
	"$(ZIP_FILE)" \
	"$(BUILD_DIR)/*" \
	"icons/generate-icons.js" \
	"package.json" \
	"Makefile" \
	"README.md" \
	"*.map" \
	"node_modules/*"

# ── Phony targets ─────────────────────────────────────────────────────────────
.PHONY: help icons validate pack token upload publish deploy clean open check-deps build

# ─────────────────────────────────────────────────────────────────────────────
# Help
# ─────────────────────────────────────────────────────────────────────────────
help: ## Show available targets
	@echo ""
	@echo "  Rysh AI Chrome Extension — build & publish"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Secrets are read from .env (CLIENT_ID, CLIENT_SECRET,"
	@echo "  REFRESH_TOKEN, EXTENSION_ID) or passed on the command line."
	@echo ""

# ─────────────────────────────────────────────────────────────────────────────
# React build (produces dist/)
# ─────────────────────────────────────────────────────────────────────────────
build: ## Install npm deps and build the React popup into dist/
	npm install
	npm run build
	@echo "✓ Built → dist/"

# ─────────────────────────────────────────────────────────────────────────────
# Dependency check
# ─────────────────────────────────────────────────────────────────────────────
check-deps: ## Check that required tools are installed
	@command -v node  >/dev/null 2>&1 || { echo "✗ node not found (required for icon generation)"; exit 1; }
	@command -v zip   >/dev/null 2>&1 || { echo "✗ zip not found"; exit 1; }
	@command -v curl  >/dev/null 2>&1 || { echo "✗ curl not found"; exit 1; }
	@command -v jq    >/dev/null 2>&1 || { echo "✗ jq not found (brew install jq / apt install jq)"; exit 1; }
	@echo "✓ All required tools found"

# ─────────────────────────────────────────────────────────────────────────────
# Icon generation
# ─────────────────────────────────────────────────────────────────────────────
icons: ## Generate icons/icon{16,48,128}.png via Node.js (no external deps)
	node icons/generate-icons.js
	@echo "✓ Icons generated"

# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────
validate: build ## Build first, then validate the dist/ extension
	@echo "Validating extension in dist/..."

	@# Check manifest.json is valid JSON
	@node -e "JSON.parse(require('fs').readFileSync('dist/manifest.json','utf8'))" \
		&& echo "  ✓ manifest.json is valid JSON" \
		|| { echo "  ✗ manifest.json is invalid JSON"; exit 1; }

	@# Check manifest_version is 3
	@node -e " \
		const m = JSON.parse(require('fs').readFileSync('dist/manifest.json','utf8')); \
		if (m.manifest_version !== 3) { console.error('  ✗ manifest_version must be 3'); process.exit(1); } \
		console.log('  ✓ manifest_version: 3'); \
	"

	@# Check required manifest fields
	@node -e " \
		const m = JSON.parse(require('fs').readFileSync('dist/manifest.json','utf8')); \
		['name','version','description'].forEach(f => { \
			if (!m[f]) { console.error('  ✗ manifest.' + f + ' is missing'); process.exit(1); } \
			console.log('  ✓ manifest.' + f + ':', m[f]); \
		}); \
	"

	@# Check icon files exist
	@for size in 16 48 128; do \
		f="dist/icons/icon$${size}.png"; \
		if [ -f "$$f" ]; then echo "  ✓ $$f exists"; \
		else echo "  ✗ $$f missing — run: make build"; exit 1; fi; \
	done

	@# Check core dist files exist
	@for f in popup.html background.js auth.html auth.js authService.js storage.js; do \
		if [ -f "dist/$$f" ]; then echo "  ✓ dist/$$f exists"; \
		else echo "  ✗ dist/$$f missing"; exit 1; fi; \
	done

	@echo "✓ Validation passed"

# ─────────────────────────────────────────────────────────────────────────────
# Packaging
# ─────────────────────────────────────────────────────────────────────────────
pack: validate ## Build the submission ZIP from dist/ (runs build + validate first)
	@rm -f $(ZIP_FILE)
	@cd dist && zip -r ../$(ZIP_FILE) .
	@echo "✓ Packed → $(ZIP_FILE) ($$(du -h $(ZIP_FILE) | cut -f1))"

# ─────────────────────────────────────────────────────────────────────────────
# OAuth2 access token
# ─────────────────────────────────────────────────────────────────────────────
token: ## Exchange REFRESH_TOKEN for a short-lived access token (saved to .build/)
	@$(call require_var,CLIENT_ID)
	@$(call require_var,CLIENT_SECRET)
	@$(call require_var,REFRESH_TOKEN)
	@mkdir -p $(BUILD_DIR)
	@echo "Fetching access token..."
	@curl -s -X POST "$(CWS_TOKEN_URL)" \
		-d "client_id=$(CLIENT_ID)" \
		-d "client_secret=$(CLIENT_SECRET)" \
		-d "refresh_token=$(REFRESH_TOKEN)" \
		-d "grant_type=refresh_token" \
	| jq -r '.access_token' > $(TOKEN_FILE)
	@if [ "$$(cat $(TOKEN_FILE))" = "null" ] || [ -z "$$(cat $(TOKEN_FILE))" ]; then \
		echo "✗ Failed to obtain access token — check CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN"; \
		rm -f $(TOKEN_FILE); \
		exit 1; \
	fi
	@echo "✓ Access token saved to $(TOKEN_FILE)"

# ─────────────────────────────────────────────────────────────────────────────
# Upload to Chrome Web Store
# ─────────────────────────────────────────────────────────────────────────────
upload: pack token ## Upload ZIP to the Chrome Web Store (creates new item if EXTENSION_ID is blank)
	@ACCESS_TOKEN="$$(cat $(TOKEN_FILE))"; \
	if [ -z "$(EXTENSION_ID)" ]; then \
		echo "EXTENSION_ID not set — creating a new store item..."; \
		RESPONSE=$$(curl -s -X POST "$(CWS_UPLOAD_NEW)" \
			-H "Authorization: Bearer $$ACCESS_TOKEN" \
			-H "x-goog-api-version: 2" \
			-T $(ZIP_FILE)); \
	else \
		echo "Uploading update for extension $(EXTENSION_ID)..."; \
		RESPONSE=$$(curl -s -X PUT "$(CWS_UPLOAD_UPD)" \
			-H "Authorization: Bearer $$ACCESS_TOKEN" \
			-H "x-goog-api-version: 2" \
			-T $(ZIP_FILE)); \
	fi; \
	echo "$$RESPONSE" | jq .; \
	STATUS=$$(echo "$$RESPONSE" | jq -r '.uploadState // .error.status // "UNKNOWN"'); \
	if [ "$$STATUS" = "SUCCESS" ]; then \
		echo "✓ Upload successful"; \
		NEW_ID=$$(echo "$$RESPONSE" | jq -r '.id // empty'); \
		if [ -n "$$NEW_ID" ] && [ -z "$(EXTENSION_ID)" ]; then \
			echo ""; \
			echo "  ★ New extension ID: $$NEW_ID"; \
			echo "  Add this to your .env file:  EXTENSION_ID=$$NEW_ID"; \
			echo ""; \
		fi; \
	else \
		echo "✗ Upload failed (state: $$STATUS)"; \
		exit 1; \
	fi

# ─────────────────────────────────────────────────────────────────────────────
# Publish
# ─────────────────────────────────────────────────────────────────────────────
publish: token ## Publish the uploaded version on the Chrome Web Store
	@$(call require_var,EXTENSION_ID)
	@ACCESS_TOKEN="$$(cat $(TOKEN_FILE))"; \
	echo "Publishing extension $(EXTENSION_ID)..."; \
	RESPONSE=$$(curl -s -X POST "$(CWS_PUBLISH_URL)" \
		-H "Authorization: Bearer $$ACCESS_TOKEN" \
		-H "x-goog-api-version: 2" \
		-H "Content-Length: 0"); \
	echo "$$RESPONSE" | jq .; \
	STATUS=$$(echo "$$RESPONSE" | jq -r '.status[0] // .error.status // "UNKNOWN"'); \
	if [ "$$STATUS" = "OK" ]; then \
		echo "✓ Published — extension is now in review"; \
	else \
		echo "✗ Publish failed (status: $$STATUS)"; \
		exit 1; \
	fi

# ─────────────────────────────────────────────────────────────────────────────
# Full pipeline
# ─────────────────────────────────────────────────────────────────────────────
deploy: pack token ## Full pipeline: validate → pack → upload → publish
	@$(MAKE) --no-print-directory upload
	@$(MAKE) --no-print-directory publish
	@echo ""
	@echo "✓ Deploy complete — extension submitted for review"

# ─────────────────────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────────────────────
open: ## Open the Chrome Web Store Developer Dashboard in the browser
	@open "$(CWS_DASHBOARD)" 2>/dev/null \
		|| xdg-open "$(CWS_DASHBOARD)" 2>/dev/null \
		|| echo "Open: $(CWS_DASHBOARD)"

clean: ## Remove build artefacts (ZIP, token cache)
	rm -f $(ZIP_FILE)
	rm -rf $(BUILD_DIR)
	@echo "✓ Cleaned"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
define require_var
	@if [ -z "$($(1))" ]; then \
		echo "✗ $(1) is not set — add it to .env or pass it on the CLI"; \
		exit 1; \
	fi
endef

.PHONY: install setup dev ext test test-watch coverage \
       build build-ts build-ext build-native icons dist clean \
       lint lint-fix format format-check help

# ── Install (production) ─────────────────────────

install: dist  ## Build .dmg and install MeetPods as a macOS app
	@open dist/MeetPods-*.dmg
	@echo ""
	@echo "\033[32m✓ DMG opened — drag MeetPods to Applications.\033[0m"
	@echo ""
	@echo "  First launch: right-click MeetPods.app → Open (Gatekeeper bypass)."
	@echo ""
	@echo "  Chrome extension (one-time setup):"
	@echo "     1. Open \033[36mchrome://extensions\033[0m"
	@echo "     2. Enable \033[33mDeveloper mode\033[0m (top right)"
	@echo "     3. Click \033[33mLoad unpacked\033[0m → select:"
	@echo "        \033[36m/Applications/MeetPods.app/Contents/Resources/extension\033[0m"
	@echo ""

# ── Development ──────────────────────────────────

setup:  ## First-time dev setup (install deps + full build)
	npm install
	@$(MAKE) build
	@echo ""
	@echo "\033[32m✓ Dev environment ready!\033[0m"
	@echo ""
	@echo "  \033[36mmake dev\033[0m   Launch app (dev mode)"
	@echo "  \033[36mmake ext\033[0m   Load Chrome extension from dist/extension/"
	@echo "  \033[36mmake test\033[0m  Run tests"
	@echo ""

dev: build-ts build-ext  ## Launch app in dev mode (fast — skips native rebuild)
	npx electron .

ext:  ## Open Chrome to load/reload the dev extension
	@echo "Extension path: \033[36m$(CURDIR)/dist/extension\033[0m"
	@open "chrome://extensions/"

# ── Testing ──────────────────────────────────────

test:  ## Run tests
	npx vitest run

test-watch:  ## Run tests in watch mode
	npx vitest

coverage:  ## Run tests with coverage report
	npx vitest run --coverage

# ── Build ────────────────────────────────────────

build: build-ts build-ext build-native  ## Full build (TS + extension + native)

build-ts:
	npx tsc

build-ext:
	node scripts/build-extension.mjs

build-native:
	npx node-gyp rebuild --directory=src/native

icons:  ## Regenerate all icons (tray + app)
	node scripts/generate-icons.js
	node scripts/generate-app-icon.js

dist: build  ## Build .dmg installer (no auto-open)
	node scripts/rebuild-native.js
	npx electron-builder

clean:  ## Remove all build artifacts
	rm -rf dist src/native/build

# ── Code Quality ────────────────────────────────

lint:  ## Run ESLint
	npx eslint src/

lint-fix:  ## Run ESLint with auto-fix
	npx eslint src/ --fix

format:  ## Format code with Prettier
	npx prettier --write .

format-check:  ## Check code formatting
	npx prettier --check .

# ── Help ─────────────────────────────────────────

help:  ## Show available commands
	@echo ""
	@echo "  \033[1mMeetPods\033[0m — AirPods mute control for Google Meet"
	@echo ""
	@echo "  \033[90mInstall as app:\033[0m"
	@echo "    \033[36mmake install\033[0m     Build .dmg and install MeetPods as a macOS app"
	@echo ""
	@echo "  \033[90mDevelopment:\033[0m"
	@grep -E '^(setup|dev|ext):.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "    \033[36mmake %-12s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  \033[90mTesting:\033[0m"
	@grep -E '^(test|test-watch|coverage):.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "    \033[36mmake %-12s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  \033[90mBuild:\033[0m"
	@grep -E '^(build|icons|dist|clean):.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "    \033[36mmake %-12s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  \033[90mCode quality:\033[0m"
	@grep -E '^(lint|lint-fix|format|format-check):.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "    \033[36mmake %-12s\033[0m %s\n", $$1, $$2}'
	@echo ""

.DEFAULT_GOAL := help

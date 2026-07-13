# Makefile for inventory-mobile (SvelteKit)
# Usage: run `make help` to list available targets.

# Use npm; override with `make NPM=pnpm ...` if desired.
NPM ?= npm

.DEFAULT_GOAL := help

.PHONY: help install dev dev-all build preview check lint format test test-watch \
        test-coverage verify ci clean \
        mobile-add-ios mobile-add-android mobile-sync mobile-ios mobile-android \
        convex-dev convex-deploy

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies (clean, reproducible)
	$(NPM) ci

dev: ## Run the frontend dev server (hot reload)
	$(NPM) run dev

dev-all: ## Run frontend + Convex dev deployment concurrently (Ctrl-C kills both)
	@trap 'kill 0' EXIT; \
		echo "Starting Convex dev (pushes convex/ on change) …"; \
		npx convex dev & \
		echo "Starting frontend (http://localhost:5173) …"; \
		$(NPM) run dev & \
		wait

build: ## Production build
	$(NPM) run build

preview: ## Preview the production build locally
	$(NPM) run preview

check: ## Type-check + Svelte diagnostics (svelte-check)
	$(NPM) run check

lint: ## Lint (prettier --check + eslint)
	$(NPM) run lint

format: ## Auto-format with prettier
	$(NPM) run format

test: ## Run unit tests (vitest, single run)
	$(NPM) run test

test-watch: ## Run unit tests in watch mode
	$(NPM) run test:watch

test-coverage: ## Run unit tests with coverage report
	$(NPM) run test:coverage

verify: test check lint ## Run tests + type-check + lint (all quality gates)

ci: install verify build ## Full CI flow: install, verify, build

clean: ## Remove build output and caches
	rm -rf build .svelte-kit node_modules/.vite

# --- Mobile (Capacitor) ---------------------------------------------------
# One-time: run mobile-add-ios / mobile-add-android to scaffold native projects.
# Requires Xcode + CocoaPods (iOS) and Android Studio + JDK (Android).

mobile-add-ios: build ## One-time: add the native iOS project
	npx cap add ios

mobile-add-android: build ## One-time: add the native Android project
	npx cap add android

mobile-sync: ## Rebuild web assets and copy them into both native projects
	$(NPM) run cap:sync

mobile-ios: ## Build, sync, and open the iOS project in Xcode
	$(NPM) run cap:ios

mobile-android: ## Build, sync, and open the Android project in Android Studio
	$(NPM) run cap:android

# --- Backend (Convex functions in ./convex) --------------------------------

convex-dev: ## Provision/watch a dev deployment; pushes convex/ on change
	npx convex dev

convex-deploy: ## Push convex/ functions to the prod deployment
	npx convex deploy

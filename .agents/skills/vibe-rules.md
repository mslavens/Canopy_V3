---
name: canopy-vibe-coder
description: A custom skill for prototyping, high-level iterating, and rapid feature development on the Canopy application.
---

# Canopy Vibe Coding Flow

This skill establishes guidelines and workflows for rapid, high-level prototyping and iterative feature expansion on the Canopy codebase. When this skill is active, execute steps using the following methodology.

## 1. Always Plan First
* **Constraint**: Before editing any code files or executing commands that modify state, always create or update an `implementation_plan.md` artifact detailing:
  - The goal and user intent.
  - The proposed list of files to add, modify, or remove.
  - A simple verification plan.
* Keep plans concise to avoid blocking flow, but ensure that the architecture is clear before modifying the codebase.

## 2. File and Repository Access
* You are granted explicit permission to read, create, delete, and rewrite files anywhere within this workspace (under `/Users/mslavens/Documents/__Dev/AntigravityBuild/Canopy_V3/`) to achieve the user's high-level goals.
* Maintain clean semantic formatting, follow standard language idioms, and preserve existing structure unless direct instruction or refactoring is required.

## 3. Autonomous Verification
* After applying any code changes, always verify them using the local compilers and package managers in the integrated terminal:
  - For `canopy-core` (Go): Run `go test ./...` and `go build -o canopy-core-bin .` or compile via `build.sh` script to verify compilation and tests.
  - For `canopy-ui` (React/Vite/TS): Run `npm run build` to verify TypeScript compile-time safety and bundler compilation.
* Resolve any warnings or errors autonomously before presenting the completed task.

## 4. Tech Stack Context
* **Backend (`canopy-core`)**: Built in Go using standard `net/http` router, integrated SQLite/SQLCipher databases, and parsing/mapping adapters.
* **Frontend (`canopy-ui`)**: Built with React, TypeScript, and Vite. Uses vanilla CSS bindings for themes and layout styling.

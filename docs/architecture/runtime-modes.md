---
type: Architecture Note
title: "Runtime modes"
description: "KataCode has a global runtime mode switch in the chat toolbar:"
tags: [architecture, architecture-note]
timestamp: 2026-06-16T17:10:05Z
---

# Runtime modes

KataCode has a global runtime mode switch in the chat toolbar:

- **Full access** (default): starts sessions with `approvalPolicy: never` and `sandboxMode: danger-full-access`.
- **Supervised**: starts sessions with `approvalPolicy: on-request` and `sandboxMode: workspace-write`, then prompts in-app for command/file approvals.

# AgentK Tool Security Hardening

## Goal

Remove `apply_remediation` and make the remaining atomic tools execute through
one fail-closed authorization, scope, deadline, and output boundary.

## Constraints And Decisions

- Preserve the six canonical atomic tool names and their valid operational behavior.
- Reject duplicate registered names.
- Treat local configuration as the maximum authority and remote session policy as narrowing only.
- Return minimal receipts for writes and intentionally reject unsafe legacy inputs.
- Default scale ceiling is 100; scale-to-zero requires local and caller confirmation.

## Validation Log

- Production-readiness review fixed reconnect generation reuse, redacted
  pagination cursors, shared queue overflow/handoff races, incomplete UID
  preconditions, namespaced snapshot filtering, and unstable upstream write
  retry IDs. Node visibility remains governed by existing Kubernetes RBAC and
  is not narrowed by namespace include/exclude policy.
- `npm run validate`: passed; 168 tests plus contract, harness, Helm, and build checks.
- `npm run test:e2e`: passed; one WebSocket lifecycle test.
- Workspace validation: passed.

## Completion Criteria

AgentK validation, E2E coverage, Helm checks, and mirrored contract checks pass.

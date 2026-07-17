# Namespace Scope and Pagination Hardening

## Goal

Keep `list_resources` pagination aligned with the model-visible namespace page and prevent namespace-scope updates from leaving stale target inventory visible.

## Completed

- Generic resource pages default to 50; Namespace pages default to 100.
- Namespace model context contains compact name-only items, preserving all 100 fetched names before the Kubernetes continuation token advances.
- Regression coverage verifies complete traversal of 105 namespaces.
- Coordinated control-plane changes await live scope application and filter stored inventory by the saved scope.

## Validation

- `npm run validate`

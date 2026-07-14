# Generated Install Inline CA

## Goal

Let one generated Helm command load an operator-local PEM CA bundle and have
the AgentK chart manage the namespace-local ConfigMap used by the existing
Node.js trust mount.

## Decisions

- Preserve ConfigMap and Secret reference support.
- Accept public PEM bundles through `--set-file` and reject private keys.
- Roll AgentK when chart-managed CA content changes.
- Keep AgentK runtime, authentication, and RBAC behavior unchanged.

## Validation

- `npm run helm:check` passed.
- `npm run validate` passed.


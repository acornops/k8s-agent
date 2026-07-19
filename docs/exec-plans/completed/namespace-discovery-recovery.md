# Namespace Discovery Recovery

## Goal

Keep broad Kubernetes diagnostics inside AgentK's effective namespace scope when
a model guesses `default` instead of omitting the optional namespace filter.

## Decisions

- Treat `namespace` as irrelevant for cluster-scoped `Namespace` and `Node`
  listings by removing it during argument normalization.
- Continue rejecting forbidden namespaces for namespaced resource kinds.
- Make that rejection actionable by telling callers to omit `namespace` when
  they intend to query every namespace allowed by the effective scope.
- Do not reveal namespace names in authorization errors or broaden the local or
  remotely compiled namespace policy.

## Validation

- Focused Vitest: 42 tests passed across `list-resources.spec.ts` and
  `executor.spec.ts`.
- AgentK lint/typecheck passed.
- Full AgentK unit suite passed: 235 tests.
- AgentK contract and harness checks passed.
- AgentK production TypeScript build passed.
- Helm validation was unavailable because neither the host nor the running
  AgentK container has `helm` installed.
- Workspace platform-contract validation remains blocked by pre-existing
  manifest mismatches between control-plane, execution-engine, and llm-gateway;
  this change does not edit those manifests.

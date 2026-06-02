# K8s Agent Operations

## Runtime Contract

- The agent uses an outbound WebSocket to the platform.
- The default install is one read-only replica.
- Multi-replica installs are active-passive only and require Kubernetes Lease leader election.
- Write-capable tools require explicit RBAC and configuration opt-in.

## Required Environment

- `ACORNOPS_AGENT_PLATFORM_URL`
- `ACORNOPS_CLUSTER_ID`
- `ACORNOPS_AGENT_KEY` or an existing Secret referenced by the Helm chart
- `ACORNOPS_AGENT_WRITE_ENABLED`
- `ACORNOPS_AGENT_LEADER_ELECTION_ENABLED`

## Helm Operations

Install into a workload cluster:

```bash
helm upgrade --install acornops-agent oci://ghcr.io/acornops/charts/acornops-k8s-agent \
  --namespace acornops \
  --create-namespace \
  --set-string config.platformUrl=https://api.acornops.dev \
  --set-string config.clusterId=YOUR_CLUSTER_ID \
  --set-string config.agentKey=YOUR_AGENT_KEY
```

Check rollout:

```bash
kubectl -n acornops rollout status deployment/acornops-agent
kubectl -n acornops logs -f deployment/acornops-agent
```

## Snapshot Scalability

The current snapshot pipeline uses bounded, paginated Kubernetes list calls. Treat clusters with `<2k` pods or `<10k` watched objects as small, `2k-10k` pods or `10k-50k` watched objects as medium, and `10k+` pods or `50k+` watched objects as large. Large clusters should plan for the watch/cache architecture instead of relying on frequent full-list snapshots.

Monitor `snapshot-manager` logs for `durationMs`, `skippedSnapshots`, `droppedSnapshots`, `originalBytes`, and `compressedBytes`. Regular skipped interval snapshots mean polling is beyond the comfortable range. Increase the snapshot interval before raising `ACORNOPS_AGENT_K8S_CONCURRENCY`; higher concurrency can increase API server pressure when list latency is already the bottleneck.

## Failure Modes

- Agent cannot connect: verify `ACORNOPS_AGENT_PLATFORM_URL`, DNS, TLS, and the platform `/api/v1/agent/connect` route.
- Authentication rejected: rotate or reissue the cluster agent key from the control plane.
- No telemetry: verify Kubernetes RBAC, namespace scope, metrics-server availability, and collector logs.
- Slow or skipped telemetry: inspect `snapshot-manager` logs, increase the snapshot interval if collection takes too long, then tune `ACORNOPS_AGENT_K8S_CONCURRENCY` and `ACORNOPS_AGENT_K8S_LIST_PAGE_LIMIT` if needed.
- HA does not elect a leader: verify Lease RBAC and `leaderElection.enabled=true`.

## Required Validation

Before chart or runtime changes:

```bash
npm run validate
npm run helm:check
```

import { toolRegistry } from './registry.js';
import { getResourceLogsTool } from './atomic/get-resource-logs.js';
import { listResourcesTool } from './atomic/list-resources.js';
import { getResourceTool } from './atomic/get-resource.js';
import { restartWorkloadTool } from './atomic/restart-workload.js';
import { scaleWorkloadTool } from './atomic/scale.js';
import { simulatePatchTool } from './atomic/simulate-patch.js';

/** Register every built-in Kubernetes agent tool. */
export function registerAllTools() {
  toolRegistry.register(listResourcesTool);
  toolRegistry.register(getResourceLogsTool);
  toolRegistry.register(getResourceTool);
  toolRegistry.register(restartWorkloadTool);
  toolRegistry.register(scaleWorkloadTool);
  toolRegistry.register(simulatePatchTool);
}

import { z } from 'zod';

export type ToolCapability = 'read' | 'write';

export type ToolScope =
  | { type: 'namespaced'; namespace: string }
  | { type: 'namespace-collection'; namespace?: string }
  | { type: 'cluster'; kind: string; namespace?: string };

export interface ToolExecutionContext {
  operationId: string;
  requestId: string | number;
  sessionGeneration: number;
  signal?: AbortSignal;
}

/**
 * Defines a tool that can be executed by the agent.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  capability: ToolCapability;
  timeoutMs: number;
  version: string;
  deprecated?: boolean;
  schema: z.ZodTypeAny;
  scopeResolver: (params: any) => ToolScope;
  handler: (params: any, context?: ToolExecutionContext) => Promise<any>;
}

/**
 * Registry for managing and looking up available tools.
 */
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /**
   * Registers a new tool in the registry.
   * @param tool The tool definition to register.
   */
  public register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Return a registered tool by name. */
  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Return all registered tools. */
  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Clear registered tools for isolated tests. */
  public resetForTests(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();

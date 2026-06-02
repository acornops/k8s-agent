import { z } from 'zod';

export type ToolHandler = (params: any) => Promise<any>;
export type ToolCapability = 'read' | 'write';

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
  handler: ToolHandler;
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
}

export const toolRegistry = new ToolRegistry();

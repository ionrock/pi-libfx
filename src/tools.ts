import {
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { FxToolDescriptor, ToolExecutionListener } from "./types.js";

const toolDefinitionCache = new Map<string, ToolDefinition<any, any, any>>();

/**
 * Retrieves or caches a tool definition with renderers for the given working directory.
 */
export function getToolDefinition(name: string, cwd: string): ToolDefinition<any, any, any> | undefined {
  const key = `${cwd}:${name}`;
  if (toolDefinitionCache.has(key)) {
    return toolDefinitionCache.get(key);
  }

  let def: ToolDefinition<any, any, any> | undefined;
  switch (name) {
    case "bash":
      def = createBashToolDefinition(cwd);
      break;
    case "read":
      def = createReadToolDefinition(cwd);
      break;
    case "edit":
      def = createEditToolDefinition(cwd);
      break;
    case "write":
      def = createWriteToolDefinition(cwd);
      break;
  }

  if (def) {
    toolDefinitionCache.set(key, def);
  }
  return def;
}

let activeToolListener: ToolExecutionListener | null = null;

/**
 * Sets the active listener for host tool execution lifecycle events.
 */
export function setToolExecutionListener(listener: ToolExecutionListener | null): void {
  activeToolListener = listener;
}

/**
 * Creates executable host tools (read, bash, edit, write) for the libfx agent.
 */
export function getHostTools(ctx: ExtensionContext): FxToolDescriptor[] {
  const cwd = ctx.cwd || process.cwd();
  const tools: ToolDefinition<any, any, any>[] = [
    getToolDefinition("read", cwd)!,
    getToolDefinition("bash", cwd)!,
    getToolDefinition("edit", cwd)!,
    getToolDefinition("write", cwd)!,
  ].filter(Boolean);

  return adaptPiToolsToLibfx(tools, ctx);
}

/**
 * Adapts registered Pi tools into libfx host tool descriptors.
 */
export function adaptPiToolsToLibfx(
  tools: ToolDefinition[],
  ctx: ExtensionContext
): FxToolDescriptor[] {
  return tools.map((tool) => {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.parameters as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
      execute: async (input: unknown, { signal }: { signal: AbortSignal }) => {
        const toolCallId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        activeToolListener?.onStart?.(toolCallId, tool.name, input);

        try {
          if (signal.aborted) {
            const abortResult = { content: [{ type: "text" as const, text: "Tool execution aborted" }], isError: true };
            activeToolListener?.onEnd?.(toolCallId, abortResult, true);
            return { content: "Tool execution aborted", isError: true };
          }

          // Execute tool through Pi's native execution handler
          const result = await tool.execute(
            toolCallId,
            (input ?? {}) as any,
            signal,
            (update: any) => {
              activeToolListener?.onUpdate?.(toolCallId, update);
            },
            ctx
          );

          activeToolListener?.onEnd?.(toolCallId, result, false);

          // Extract text content from Pi's tool result format
          if (Array.isArray(result?.content)) {
            const textParts = result.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text);
            return textParts.join("\n") || "Success";
          }

          if (typeof result === "string") {
            return result;
          }

          return JSON.stringify(result ?? "Success");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const errResult = { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
          activeToolListener?.onEnd?.(toolCallId, errResult, true);
          return { content: `Error executing ${tool.name}: ${message}`, isError: true };
        }
      },
    };
  });
}

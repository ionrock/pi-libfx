import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { FxToolDescriptor } from "./types.js";

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
        try {
          if (signal.aborted) {
            return { content: "Tool execution aborted", isError: true };
          }

          // Execute tool through Pi's native execution handler
          const result = await tool.execute(
            toolCallId,
            (input ?? {}) as any,
            signal,
            (_update: any) => {
              // Real-time update hook
            },
            ctx
          );

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
          return { content: `Error executing ${tool.name}: ${message}`, isError: true };
        }
      },
    };
  });
}

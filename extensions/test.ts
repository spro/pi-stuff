import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"

export default function (pi: ExtensionAPI) {
    pi.on("session_start", async (_event, ctx) => {
        ctx.ui.notify("Extension loaded!", "info")
    })

    pi.on("agent_end", async (_event, ctx) => {
        ctx.ui.notify("Something happened", "info")
    })

    // pi.on("tool_call", async (event, ctx) => {
    //   ctx.ui.notify(
    //     `Calling ${event.toolName} with input: ${JSON.stringify(event.input, null, 4)}`,
    //   );
    //   if (event.toolName === "bash" && event.input.command?.includes("ls")) {
    //     const ok = await ctx.ui.confirm("Dangerous!", "Allow ls?");
    //     if (!ok)
    //       return {
    //         block: true,
    //         reason:
    //           "Blocked by user (this is a test to block the ls command for fun)",
    //       };
    //   }
    // });

    pi.registerTool({
        name: "greet",
        label: "Greet",
        description: "Greet someone by name",
        parameters: Type.Object({
            name: Type.String({ description: "Name to greet" }),
        }),
        async execute(toolCallId, params, signal, onUpdate, ctx) {
            const name = await ctx.ui.input("Name:")
            ctx.ui.notify(`They entered ${name}`)
            return {
                content: [{ type: "text", text: `Hello, ${params.name}!` }],
                details: {},
            }
        },
    })

    pi.registerCommand("hello", {
        description: "Say Hello",
        handler: async (args, ctx) => {
            ctx.ui.notify(`Hi there ${args || "world"}!`, "info")
        },
    })
}

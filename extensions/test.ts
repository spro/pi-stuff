import { writeFile } from "node:fs/promises"
import path from "node:path"
import { complete } from "@mariozechner/pi-ai"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"

type ContentBlock = {
    type?: string
    text?: string
    name?: string
    arguments?: Record<string, unknown>
}

type SessionEntry = {
    type: string
    message?: {
        role?: string
        content?: unknown
    }
}

const extractTextParts = (content: unknown): string[] => {
    if (typeof content === "string") {
        return [content]
    }

    if (!Array.isArray(content)) {
        return []
    }

    const textParts: string[] = []
    for (const part of content) {
        if (!part || typeof part !== "object") {
            continue
        }

        const block = part as ContentBlock
        if (block.type === "text" && typeof block.text === "string") {
            textParts.push(block.text)
        }
    }

    return textParts
}

const extractToolCallLines = (content: unknown): string[] => {
    if (!Array.isArray(content)) {
        return []
    }

    const toolCalls: string[] = []
    for (const part of content) {
        if (!part || typeof part !== "object") {
            continue
        }

        const block = part as ContentBlock
        if (block.type !== "toolCall" || typeof block.name !== "string") {
            continue
        }

        const args = block.arguments ?? {}
        toolCalls.push(`- Tool: ${block.name} ${JSON.stringify(args)}`)
    }

    return toolCalls
}

const buildConversationText = (entries: SessionEntry[]): string => {
    const sections: string[] = []

    for (const entry of entries) {
        if (entry.type !== "message" || !entry.message?.role) {
            continue
        }

        const role = entry.message.role
        const isUser = role === "user"
        const isAssistant = role === "assistant"

        if (!isUser && !isAssistant) {
            continue
        }

        const roleLabel = isUser ? "User" : "Assistant"
        const textParts = extractTextParts(entry.message.content)
        const toolCalls = isAssistant
            ? extractToolCallLines(entry.message.content)
            : []
        const body: string[] = []

        if (textParts.length > 0) {
            const messageText = textParts.join("\n").trim()
            if (messageText.length > 0) {
                body.push(messageText)
            }
        }

        if (toolCalls.length > 0) {
            body.push("Tool calls:\n" + toolCalls.join("\n"))
        }

        if (body.length > 0) {
            sections.push(`## ${roleLabel}\n\n${body.join("\n\n")}`)
        }
    }

    return sections.join("\n\n")
}

const formatDateStamp = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    const hours = String(date.getHours()).padStart(2, "0")
    const minutes = String(date.getMinutes()).padStart(2, "0")
    return `${year}${month}${day}-${hours}${minutes}`
}

const buildSummaryPrompt = (conversationText: string): string =>
    [
        "Summarize this conversation so it can be resumed later.",
        "Include: goals, key decisions, progress made, important constraints, open questions, and next steps.",
        "Write concise markdown with headings and bullet points.",
        "",
        "<conversation>",
        conversationText,
        "</conversation>",
    ].join("\n")

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

    pi.registerCommand("summarize", {
        description:
            "Generate a summary of the current conversation and write it to SUMMARY-YYYYMMDD-HHMM.md",
        handler: async (_args, ctx) => {
            const branch = ctx.sessionManager.getBranch() as SessionEntry[]
            const conversationText = buildConversationText(branch).trim()

            if (!conversationText) {
                ctx.ui.notify("No conversation text found", "warning")
                return
            }

            ctx.ui.notify("Generating summary...", "info")

            const model = ctx.model
            if (!model) {
                ctx.ui.notify(
                    "No active model found for this session",
                    "warning",
                )
                return
            }

            const apiKey = await ctx.modelRegistry.getApiKey(model)
            if (!apiKey) {
                ctx.ui.notify(
                    `No auth available for ${model.provider}/${model.id}`,
                    "warning",
                )
                return
            }

            const summaryPrompt = buildSummaryPrompt(conversationText)
            ctx.ui.notify(apiKey, "info")
            ctx.ui.notify(summaryPrompt, "info")

            const response = await complete(
                model,
                {
                    systemPrompt:
                        "You are a concise assistant that summarizes conversations for later resumption.",
                    messages: [
                        {
                            role: "user" as const,
                            content: [
                                {
                                    type: "text" as const,
                                    text: summaryPrompt,
                                },
                            ],
                            timestamp: Date.now(),
                        },
                    ],
                },
                { apiKey },
            )

            ctx.ui.notify(JSON.stringify(response, null, 4), "info")
            const summary = response.content
                .filter(
                    (c): c is { type: "text"; text: string } =>
                        c.type === "text",
                )
                .map((c) => c.text)
                .join("\n")
                .trim()

            if (!summary) {
                ctx.ui.notify("The model returned an empty summary", "warning")
                return
            }

            const date = new Date()
            const dateStamp = formatDateStamp(date)
            const fileName = `SUMMARY-${dateStamp}.md`
            const filePath = path.join(ctx.cwd, fileName)
            const content = `# Conversation Summary\n\nGenerated: ${date.toISOString()}\nModel: ${model.provider}/${model.id}\n\n${summary}\n`

            await writeFile(filePath, content, "utf8")
            ctx.ui.notify(`Wrote ${fileName}`, "info")
        },
    })
}

/**
 * Auto session title extension.
 *
 * Gives each new session a short title based on the first user message.
 * It sets a quick heuristic title immediately, then refines it after the
 * first prompt finishes by calling a model directly via pi-ai.
 *
 * Titles are also persisted as JSON files in:
 *   ~/.pi/agent/session-titles/
 *
 * Each session gets its own record file keyed by session id. On session
 * start/switch, the extension restores the saved title if Pi does not
 * already have one loaded.
 *
 * Optional environment variable:
 *   PI_SESSION_TITLE_MODEL=provider/model-id
 *
 * If no dedicated title model is configured or available, the current
 * session model is used instead.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { complete } from "@mariozechner/pi-ai"
import type {
    ExtensionAPI,
    ExtensionCommandContext,
    ExtensionContext,
} from "@mariozechner/pi-coding-agent"

type PendingTitle = {
    sessionId: string
    prompt: string
    fallbackTitle: string
}

type TitleSource = "heuristic" | "model" | "manual"

type GeneratedTitle = {
    title: string
    source: TitleSource
    titleModel?: string
}

type SessionTitleRecord = {
    sessionId: string
    title: string
    fallbackTitle: string
    firstMessage: string
    source: TitleSource
    cwd: string
    sessionFile: string | null
    titleModel?: string
    createdAt: string
    updatedAt: string
}

type MessageBlock = {
    type?: string
    text?: string
}

type SessionEntry = {
    type?: string
    message?: {
        role?: string
        content?: unknown
    }
}

const MAX_TITLE_WORDS = 6
const MAX_TITLE_CHARS = 60
const MAX_PROMPT_CHARS = 4000
const TITLE_MODEL_ENV = "PI_SESSION_TITLE_MODEL"
const SESSION_TITLES_DIR = path.join(
    os.homedir(),
    ".pi",
    "agent",
    "session-titles",
)

const CONNECTOR_WORDS = new Set([
    "with",
    "while",
    "because",
    "since",
    "after",
    "before",
    "including",
    "using",
    "via",
    "without",
    "where",
    "when",
    "but",
    "and",
    "plus",
])

const LEAD_IN_PATTERNS = [
    /^(please\s+)+(?:help\s+me\s+)?/i,
    /^(?:can|could|would|will)\s+you\s+/i,
    /^(?:help\s+me\s+)(?:to\s+)?/i,
    /^i\s+(?:need|want)\s+(?:you\s+)?to\s+/i,
    /^let'?s\s+/i,
    /^we\s+need\s+to\s+/i,
    /^i'?m\s+(?:trying|working)\s+to\s+/i,
]

const normalizeWhitespace = (text: string): string =>
    text.replace(/\s+/g, " ").trim()

const trimTitleLength = (title: string): string => {
    if (title.length <= MAX_TITLE_CHARS) {
        return title
    }

    const shortened = title.slice(0, MAX_TITLE_CHARS)
    const withoutPartialWord = shortened.replace(/\s+\S*$/, "")
    return withoutPartialWord.trim() || shortened.trim()
}

const sanitizeTitle = (raw: string): string => {
    const firstLine =
        raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean) ?? ""

    let title = firstLine
        .replace(/^title\s*:\s*/i, "")
        .replace(/^#+\s*/, "")
        .replace(/^[-*•]\s+/, "")
        .replace(/^['"`]+|['"`]+$/g, "")
        .replace(/^\*+|\*+$/g, "")
        .replace(/^_+|_+$/g, "")

    title = normalizeWhitespace(title)
    title = title.replace(/[.!?,;:]+$/g, "")

    if (!title) {
        return ""
    }

    const words = title.split(" ")
    if (words.length > MAX_TITLE_WORDS) {
        title = words.slice(0, MAX_TITLE_WORDS).join(" ")
    }

    return trimTitleLength(title)
}

const stripLeadIn = (text: string): string => {
    let result = text.trim()

    while (true) {
        let changed = false
        for (const pattern of LEAD_IN_PATTERNS) {
            const next = result.replace(pattern, "").trim()
            if (next !== result) {
                result = next
                changed = true
            }
        }
        if (!changed) {
            return result
        }
    }
}

const buildFallbackTitle = (prompt: string): string => {
    const firstMeaningfulLine =
        prompt
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find(Boolean) ?? prompt

    let cleaned = firstMeaningfulLine
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[[^\]]+\]\([^)]*\)/g, " ")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/@\S+/g, " ")
        .replace(/^#+\s*/, "")
        .replace(/^>+\s*/, "")
        .replace(/^[-*•]\s+/, "")

    cleaned = stripLeadIn(normalizeWhitespace(cleaned))

    const rawWords = cleaned.split(" ").filter(Boolean)
    if (rawWords.length === 0) {
        return sanitizeTitle(normalizeWhitespace(prompt))
    }

    let end = Math.min(rawWords.length, MAX_TITLE_WORDS)
    for (let i = 3; i < Math.min(rawWords.length, 12); i += 1) {
        const word = rawWords[i]
            ?.toLowerCase()
            .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
        if (word && CONNECTOR_WORDS.has(word)) {
            end = i
            break
        }
    }

    return sanitizeTitle(rawWords.slice(0, end).join(" "))
}

const buildTitlePrompt = (prompt: string): string =>
    [
        "Create a very short session title for this first user message.",
        "",
        "Rules:",
        "- 2 to 6 words",
        "- no quotes",
        "- no markdown",
        "- no trailing punctuation",
        "- capture the main coding task or topic",
        "- ignore filler, greetings, and extra details",
        "",
        'Example: "Please help me refactor the auth middleware and keep the API stable" -> "refactor auth middleware"',
        "",
        "<first_message>",
        prompt.slice(0, MAX_PROMPT_CHARS),
        "</first_message>",
    ].join("\n")

const getTextFromContent = (content: unknown): string => {
    if (typeof content === "string") {
        return content
    }

    if (!Array.isArray(content)) {
        return ""
    }

    return content
        .map((part) => {
            if (!part || typeof part !== "object") {
                return ""
            }
            const block = part as MessageBlock
            return block.type === "text" && typeof block.text === "string"
                ? block.text
                : ""
        })
        .filter(Boolean)
        .join("\n")
}

const countUserMessages = (entries: SessionEntry[]): number =>
    entries.filter(
        (entry) => entry.type === "message" && entry.message?.role === "user",
    ).length

const getFirstUserMessageText = (entries: SessionEntry[]): string => {
    const firstUserMessage = entries.find(
        (entry) => entry.type === "message" && entry.message?.role === "user",
    )

    return getTextFromContent(firstUserMessage?.message?.content).trim()
}

const parseModelSpec = (
    spec: string,
): { provider: string; modelId: string } | null => {
    const trimmed = spec.trim()
    const slashIndex = trimmed.indexOf("/")
    if (slashIndex <= 0 || slashIndex === trimmed.length - 1) {
        return null
    }

    return {
        provider: trimmed.slice(0, slashIndex),
        modelId: trimmed.slice(slashIndex + 1),
    }
}

const getModelKey = (model: { provider?: string; id?: string }): string =>
    [model.provider, model.id].filter(Boolean).join("/")

const getSessionId = (ctx: ExtensionContext): string | null => {
    const value = ctx.sessionManager.getSessionId?.()
    return typeof value === "string" && value.trim() ? value.trim() : null
}

const getSessionFile = (ctx: ExtensionContext): string | null => {
    const value = ctx.sessionManager.getSessionFile?.()
    return typeof value === "string" && value.trim() ? value.trim() : null
}

const getTitleRecordPath = (sessionId: string): string => {
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_")
    return path.join(SESSION_TITLES_DIR, `${safeSessionId}.json`)
}

const readTitleRecord = async (
    sessionId: string,
): Promise<SessionTitleRecord | null> => {
    try {
        const content = await readFile(getTitleRecordPath(sessionId), "utf8")
        const parsed = JSON.parse(content) as Partial<SessionTitleRecord>
        if (!parsed || typeof parsed.title !== "string") {
            return null
        }

        return {
            sessionId,
            title: parsed.title,
            fallbackTitle:
                typeof parsed.fallbackTitle === "string"
                    ? parsed.fallbackTitle
                    : parsed.title,
            firstMessage:
                typeof parsed.firstMessage === "string"
                    ? parsed.firstMessage
                    : "",
            source:
                parsed.source === "heuristic" ||
                parsed.source === "model" ||
                parsed.source === "manual"
                    ? parsed.source
                    : "heuristic",
            cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
            sessionFile:
                typeof parsed.sessionFile === "string"
                    ? parsed.sessionFile
                    : null,
            titleModel:
                typeof parsed.titleModel === "string"
                    ? parsed.titleModel
                    : undefined,
            createdAt:
                typeof parsed.createdAt === "string"
                    ? parsed.createdAt
                    : new Date().toISOString(),
            updatedAt:
                typeof parsed.updatedAt === "string"
                    ? parsed.updatedAt
                    : new Date().toISOString(),
        }
    } catch {
        return null
    }
}

const writeTitleRecord = async (
    ctx: ExtensionContext,
    data: {
        sessionId: string
        title: string
        fallbackTitle: string
        firstMessage: string
        source: TitleSource
        titleModel?: string
    },
): Promise<void> => {
    const existing = await readTitleRecord(data.sessionId)
    const now = new Date().toISOString()

    const record: SessionTitleRecord = {
        sessionId: data.sessionId,
        title: data.title,
        fallbackTitle: data.fallbackTitle,
        firstMessage: data.firstMessage,
        source: data.source,
        cwd: ctx.cwd,
        sessionFile: getSessionFile(ctx),
        titleModel: data.titleModel,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    }

    await mkdir(SESSION_TITLES_DIR, { recursive: true })
    await writeFile(
        getTitleRecordPath(data.sessionId),
        `${JSON.stringify(record, null, 4)}\n`,
        "utf8",
    )
}

const restoreSavedTitle = async (
    pi: ExtensionAPI,
    ctx: ExtensionContext,
): Promise<void> => {
    if (pi.getSessionName()) {
        return
    }

    const sessionId = getSessionId(ctx)
    if (!sessionId) {
        return
    }

    const record = await readTitleRecord(sessionId)
    if (!record?.title) {
        return
    }

    pi.setSessionName(record.title)
}

const syncCurrentTitle = async (
    pi: ExtensionAPI,
    ctx: ExtensionContext,
): Promise<void> => {
    const sessionId = getSessionId(ctx)
    if (!sessionId) {
        return
    }

    const currentTitle = sanitizeTitle(pi.getSessionName() ?? "")
    if (!currentTitle) {
        return
    }

    const existing = await readTitleRecord(sessionId)
    if (existing?.title === currentTitle) {
        return
    }

    const branch = ctx.sessionManager.getBranch() as SessionEntry[]
    const firstMessage =
        getFirstUserMessageText(branch) ||
        existing?.firstMessage ||
        currentTitle
    const fallbackTitle =
        existing?.fallbackTitle ||
        buildFallbackTitle(firstMessage) ||
        currentTitle

    await writeTitleRecord(ctx, {
        sessionId,
        title: currentTitle,
        fallbackTitle,
        firstMessage,
        source: "manual",
        titleModel: existing?.titleModel,
    })
}

const resolveTitleModel = async (ctx: ExtensionContext) => {
    const configuredModel = process.env[TITLE_MODEL_ENV]?.trim()

    if (configuredModel) {
        const parsed = parseModelSpec(configuredModel)
        if (parsed) {
            const model = ctx.modelRegistry.find(
                parsed.provider,
                parsed.modelId,
            )
            if (model) {
                const apiKey = await ctx.modelRegistry.getApiKey(model)
                if (apiKey) {
                    return { model, apiKey }
                }
            }
        }
    }

    if (!ctx.model) {
        return null
    }

    const apiKey = await ctx.modelRegistry.getApiKey(ctx.model)
    if (!apiKey) {
        return null
    }

    return { model: ctx.model, apiKey }
}

const generateTitle = async (
    ctx: ExtensionContext,
    prompt: string,
    fallbackTitle: string,
): Promise<GeneratedTitle> => {
    const resolved = await resolveTitleModel(ctx)
    if (!resolved) {
        return { title: fallbackTitle, source: "heuristic" }
    }

    const titleModel = getModelKey(resolved.model)

    try {
        const response = await complete(
            resolved.model,
            {
                systemPrompt:
                    "You generate concise session titles for coding conversations.",
                messages: [
                    {
                        role: "user" as const,
                        content: [
                            {
                                type: "text" as const,
                                text: buildTitlePrompt(prompt),
                            },
                        ],
                        timestamp: Date.now(),
                    },
                ],
            },
            {
                apiKey: resolved.apiKey,
                maxTokens: 24,
            },
        )

        const title = sanitizeTitle(
            response.content
                .filter(
                    (block): block is { type: "text"; text: string } =>
                        block.type === "text",
                )
                .map((block) => block.text)
                .join("\n"),
        )

        return {
            title: title || fallbackTitle,
            source: "model",
            titleModel,
        }
    } catch {
        return { title: fallbackTitle, source: "heuristic" }
    }
}

export default function sessionTitleExtension(pi: ExtensionAPI) {
    let pendingTitle: PendingTitle | null = null

    const clearPendingTitle = () => {
        pendingTitle = null
    }

    const restoreForSession = async (
        _event: unknown,
        ctx: ExtensionContext,
    ) => {
        clearPendingTitle()
        await restoreSavedTitle(pi, ctx)
    }

    pi.on("session_start", restoreForSession)
    pi.on("session_switch", restoreForSession)
    pi.on("session_before_switch", async (_event, ctx) => {
        await syncCurrentTitle(pi, ctx)
    })
    pi.on("session_shutdown", async (_event, ctx) => {
        clearPendingTitle()
        await syncCurrentTitle(pi, ctx)
    })

    pi.on("before_agent_start", async (event, ctx) => {
        const sessionId = getSessionId(ctx)
        if (!sessionId) {
            return
        }

        if (pendingTitle?.sessionId === sessionId) {
            clearPendingTitle()
        }

        if (pi.getSessionName()) {
            return
        }

        const branch = ctx.sessionManager.getBranch() as SessionEntry[]
        if (countUserMessages(branch) > 0) {
            return
        }

        const prompt =
            typeof event.prompt === "string" ? event.prompt.trim() : ""
        if (!prompt) {
            return
        }

        const fallbackTitle = buildFallbackTitle(prompt)
        if (!fallbackTitle) {
            return
        }

        pi.setSessionName(fallbackTitle)
        pendingTitle = {
            sessionId,
            prompt,
            fallbackTitle,
        }

        try {
            await writeTitleRecord(ctx, {
                sessionId,
                title: fallbackTitle,
                fallbackTitle,
                firstMessage: prompt,
                source: "heuristic",
            })
        } catch {
            // Ignore file persistence errors and keep the in-session title.
        }
    })

    pi.on("agent_end", async (_event, ctx) => {
        if (!pendingTitle) {
            await syncCurrentTitle(pi, ctx)
            return
        }

        const sessionId = getSessionId(ctx)
        if (sessionId !== pendingTitle.sessionId) {
            clearPendingTitle()
            await syncCurrentTitle(pi, ctx)
            return
        }

        const { prompt, fallbackTitle } = pendingTitle
        clearPendingTitle()

        const currentTitle = pi.getSessionName()
        if (currentTitle && currentTitle !== fallbackTitle) {
            await syncCurrentTitle(pi, ctx)
            return
        }

        const generated = await generateTitle(ctx, prompt, fallbackTitle)
        if (!generated.title) {
            return
        }

        const latestTitle = pi.getSessionName()
        if (!latestTitle || latestTitle === fallbackTitle) {
            pi.setSessionName(generated.title)
        }

        try {
            await writeTitleRecord(ctx, {
                sessionId,
                title: generated.title,
                fallbackTitle,
                firstMessage: prompt,
                source: generated.source,
                titleModel: generated.titleModel,
            })
        } catch {
            // Ignore file persistence errors and keep the in-session title.
        }
    })

    const generateSessionTitleForCurrentSession = async (
        args: string,
        ctx: ExtensionCommandContext,
    ) => {
        const sessionId = getSessionId(ctx)
        if (!sessionId) {
            ctx.ui.notify("No session id available", "warning")
            return
        }

        const explicitText = args.trim()
        const branch = ctx.sessionManager.getBranch() as SessionEntry[]
        const sourceText = explicitText || getFirstUserMessageText(branch)

        if (!sourceText) {
            ctx.ui.notify("No message text available to title", "warning")
            return
        }

        const fallbackTitle = buildFallbackTitle(sourceText)
        const generated = await generateTitle(ctx, sourceText, fallbackTitle)
        if (!generated.title) {
            ctx.ui.notify("Could not generate a session title", "warning")
            return
        }

        pi.setSessionName(generated.title)
        clearPendingTitle()

        try {
            await writeTitleRecord(ctx, {
                sessionId,
                title: generated.title,
                fallbackTitle,
                firstMessage: sourceText,
                source: explicitText ? "manual" : generated.source,
                titleModel: generated.titleModel,
            })
        } catch {
            // Ignore file persistence errors and keep the in-session title.
        }

        ctx.ui.notify(`Session title: ${generated.title}`, "info")
    }

    pi.registerCommand("retitle", {
        description:
            "Regenerate the current session title from the first message or supplied text",
        handler: generateSessionTitleForCurrentSession,
    })

    pi.registerCommand("generate-title", {
        description:
            "Generate a session title for the current session from its first message or supplied text",
        handler: generateSessionTitleForCurrentSession,
    })
}

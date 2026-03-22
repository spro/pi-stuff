/**
 * Project Search Extension
 *
 * Adds a `project_search` tool backed by ripgrep (`rg`) for fast codebase search.
 * It stays scoped to the current project, respects ignore files by default, and
 * returns grouped file/line hits that are easier for the model to use than raw
 * shell output.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"

const DEFAULT_MAX_RESULTS = 100
const MAX_MAX_RESULTS = 500
const MAX_TOOL_LINES = 2000
const MAX_TOOL_BYTES = 50 * 1024
const MAX_SNIPPET_CHARS = 220
const MAX_STDERR_CHARS = 16 * 1024

const PROJECT_SEARCH_PARAMS = Type.Object({
    query: Type.String({
        description: "Text or regex to search for in the current project",
    }),
    path: Type.Optional(
        Type.String({
            description:
                "Optional file or subdirectory to search within, relative to the current project",
        }),
    ),
    glob: Type.Optional(
        Type.String({
            description: "Optional ripgrep glob filter, for example '*.ts'",
        }),
    ),
    fixedStrings: Type.Optional(
        Type.Boolean({
            description: "Treat query as a literal string instead of a regex",
        }),
    ),
    caseSensitive: Type.Optional(
        Type.Boolean({
            description: "Use case-sensitive matching instead of smart-case",
        }),
    ),
    hidden: Type.Optional(
        Type.Boolean({
            description: "Include hidden files and directories",
        }),
    ),
    noIgnore: Type.Optional(
        Type.Boolean({
            description:
                "Include files normally excluded by .gitignore and other ignore files",
        }),
    ),
    maxResults: Type.Optional(
        Type.Integer({
            description: `Maximum number of matching lines to return (default: ${DEFAULT_MAX_RESULTS}, max: ${MAX_MAX_RESULTS})`,
            minimum: 1,
            maximum: MAX_MAX_RESULTS,
        }),
    ),
})

type ProjectSearchInput = {
    query: string
    path?: string
    glob?: string
    fixedStrings?: boolean
    caseSensitive?: boolean
    hidden?: boolean
    noIgnore?: boolean
    maxResults?: number
}

type SearchHit = {
    path: string
    line: number
    column: number
    text: string
}

type SearchRun = {
    hits: SearchHit[]
    totalHits: number
    totalFiles: number
    stderr: string
    rgArgs: string[]
}

type TruncationResult = {
    content: string
    truncated: boolean
    outputLines: number
    totalLines: number
    outputBytes: number
    totalBytes: number
}

function clampMaxResults(value: number | undefined): number {
    if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS
    return Math.max(1, Math.min(MAX_MAX_RESULTS, Math.floor(value as number)))
}

function stripPathPrefix(value: string): string {
    const trimmed = value.trim()
    return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed
}

function normalizePathForDisplay(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "")
}

function resolveSearchScope(
    cwd: string,
    rawPath?: string,
): { cwd: string; searchPath: string; displayScope: string } {
    const visibleRoot = path.resolve(cwd)
    const canonicalRoot = existsSync(visibleRoot)
        ? realpathSync(visibleRoot)
        : visibleRoot

    let candidate = rawPath && rawPath.trim() ? stripPathPrefix(rawPath) : "."

    if (candidate === "~") {
        candidate = os.homedir()
    } else if (candidate.startsWith("~/")) {
        candidate = path.join(os.homedir(), candidate.slice(2))
    }

    const resolvedVisible = path.isAbsolute(candidate)
        ? path.resolve(candidate)
        : path.resolve(visibleRoot, candidate)

    const resolvedCanonical = existsSync(resolvedVisible)
        ? realpathSync(resolvedVisible)
        : resolvedVisible

    const canonicalRelative = path.relative(canonicalRoot, resolvedCanonical)
    if (
        canonicalRelative.startsWith("..") ||
        path.isAbsolute(canonicalRelative)
    ) {
        throw new Error(
            "project_search can only search inside the current project",
        )
    }

    if (!existsSync(resolvedVisible)) {
        throw new Error(`Search path not found: ${candidate}`)
    }

    const visibleRelative = path.relative(visibleRoot, resolvedVisible) || "."
    const displayScope =
        visibleRelative === "."
            ? "."
            : `./${normalizePathForDisplay(visibleRelative)}`

    return {
        cwd: visibleRoot,
        searchPath: visibleRelative,
        displayScope,
    }
}

function decodeJsonTextBlock(block: unknown): string {
    if (!block || typeof block !== "object") {
        return ""
    }

    const record = block as Record<string, unknown>
    if (typeof record.text === "string") {
        return record.text
    }

    const bytes = record.bytes
    if (Array.isArray(bytes)) {
        const values = bytes.filter(
            (value): value is number => typeof value === "number",
        )
        return Buffer.from(values).toString("utf8")
    }

    return ""
}

function clampNumber(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback
    }
    return value
}

function buildSnippet(rawLine: string, column: number): string {
    const line = rawLine.replace(/\r?\n/g, "").replace(/\t/g, "    ").trimEnd()
    if (line.length <= MAX_SNIPPET_CHARS) {
        return line
    }

    const focus = Math.max(0, Math.min(line.length - 1, column - 1))
    const halfWindow = Math.floor(MAX_SNIPPET_CHARS / 2)

    let start = Math.max(0, focus - halfWindow)
    let end = Math.min(line.length, start + MAX_SNIPPET_CHARS)
    start = Math.max(0, end - MAX_SNIPPET_CHARS)

    let snippet = line.slice(start, end)
    if (start > 0) snippet = `…${snippet}`
    if (end < line.length) snippet = `${snippet}…`
    return snippet
}

function parseSearchHit(line: string): SearchHit | null {
    let payload: unknown
    try {
        payload = JSON.parse(line)
    } catch {
        return null
    }

    if (!payload || typeof payload !== "object") {
        return null
    }

    const event = payload as Record<string, unknown>
    if (event.type !== "match") {
        return null
    }

    const data = event.data
    if (!data || typeof data !== "object") {
        return null
    }

    const match = data as Record<string, unknown>
    const filePath = normalizePathForDisplay(decodeJsonTextBlock(match.path))
    if (!filePath) {
        return null
    }

    const submatches = Array.isArray(match.submatches) ? match.submatches : []
    const firstSubmatch =
        submatches.length > 0 &&
        submatches[0] &&
        typeof submatches[0] === "object"
            ? (submatches[0] as Record<string, unknown>)
            : undefined

    const column = clampNumber(firstSubmatch?.start, 0) + 1
    const text = buildSnippet(decodeJsonTextBlock(match.lines), column)

    return {
        path: filePath,
        line: clampNumber(match.line_number, 1),
        column,
        text,
    }
}

function cleanStderr(stderr: string): string {
    return stderr.replace(/\s+/g, " ").trim()
}

function pluralize(count: number, singular: string, plural?: string): string {
    return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

function buildResultText(
    params: ProjectSearchInput,
    displayScope: string,
    run: SearchRun,
    maxResults: number,
): string {
    const lines: string[] = [
        `query: ${params.query}`,
        `scope: ${displayScope}`,
        `hits: ${pluralize(run.totalHits, "matching line")} across ${pluralize(run.totalFiles, "file")}`,
    ]

    const options: string[] = [
        params.fixedStrings ? "literal" : "regex",
        params.caseSensitive ? "case-sensitive" : "smart-case",
    ]

    if (params.glob) {
        options.push(`glob=${params.glob}`)
    }
    if (params.hidden) {
        options.push("hidden")
    }
    if (params.noIgnore) {
        options.push("no-ignore")
    }

    if (options.length > 0) {
        lines.push(`options: ${options.join(", ")}`)
    }

    const warning = cleanStderr(run.stderr)
    if (warning) {
        lines.push(`warnings: ${warning}`)
    }

    if (run.totalHits === 0) {
        lines.push("", "No matches found.")
        return lines.join("\n")
    }

    if (run.totalHits > run.hits.length) {
        lines.push(
            `showing: first ${pluralize(run.hits.length, "result")} (maxResults=${maxResults}); refine the query or raise maxResults for more`,
        )
    }

    let lastPath = ""
    for (const hit of run.hits) {
        if (hit.path !== lastPath) {
            lastPath = hit.path
            lines.push("", hit.path)
        }
        lines.push(`  ${hit.line}:${hit.column}  ${hit.text}`)
    }

    return lines.join("\n")
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function trimLineToBytes(line: string, maxBytes: number): string {
    if (maxBytes <= 0) {
        return ""
    }
    if (Buffer.byteLength(line, "utf8") <= maxBytes) {
        return line
    }

    const ellipsis = "…"
    let end = line.length
    while (end > 0) {
        const candidate = `${line.slice(0, end)}${ellipsis}`
        if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
            return candidate
        }
        end -= Math.max(1, Math.ceil(end / 8))
    }

    return Buffer.byteLength(ellipsis, "utf8") <= maxBytes ? ellipsis : ""
}

function truncateForTool(text: string): TruncationResult {
    const allLines = text.split("\n")
    const totalBytes = Buffer.byteLength(text, "utf8")

    const output: string[] = []
    let outputBytes = 0

    for (const line of allLines) {
        if (output.length >= MAX_TOOL_LINES) {
            break
        }

        const prefix = output.length > 0 ? "\n" : ""
        const prefixBytes = Buffer.byteLength(prefix, "utf8")
        const lineBytes = Buffer.byteLength(line, "utf8")

        if (outputBytes + prefixBytes + lineBytes <= MAX_TOOL_BYTES) {
            output.push(line)
            outputBytes += prefixBytes + lineBytes
            continue
        }

        const remaining = MAX_TOOL_BYTES - outputBytes - prefixBytes
        const trimmed = trimLineToBytes(line, remaining)
        if (trimmed) {
            output.push(trimmed)
            outputBytes += prefixBytes + Buffer.byteLength(trimmed, "utf8")
        }
        break
    }

    return {
        content: output.join("\n"),
        truncated: output.length < allLines.length || outputBytes < totalBytes,
        outputLines: output.length,
        totalLines: allLines.length,
        outputBytes,
        totalBytes,
    }
}

function writeFullOutput(text: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pi-project-search-"))
    const outputPath = path.join(dir, "output.txt")
    writeFileSync(outputPath, text, "utf8")
    return outputPath
}

async function runRipgrep(
    cwd: string,
    args: string[],
    signal: AbortSignal | undefined,
    maxResults: number,
): Promise<SearchRun> {
    const child = spawn("rg", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
    })

    if (!child.stdout || !child.stderr) {
        throw new Error("Failed to capture ripgrep output")
    }

    const hits: SearchHit[] = []
    const matchedFiles = new Set<string>()
    let totalHits = 0
    let stderr = ""

    const onAbort = () => {
        child.kill()
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    child.stderr.setEncoding("utf8")
    const stderrPromise = new Promise<void>((resolve) => {
        child.stderr?.on("data", (chunk: string) => {
            if (stderr.length >= MAX_STDERR_CHARS) {
                return
            }
            stderr += chunk.slice(0, MAX_STDERR_CHARS - stderr.length)
        })
        child.stderr?.on("end", () => resolve())
    })

    const stdoutPromise = (async () => {
        const reader = readline.createInterface({
            input: child.stdout,
            crlfDelay: Infinity,
        })

        try {
            for await (const line of reader) {
                const hit = parseSearchHit(line)
                if (!hit) {
                    continue
                }
                totalHits += 1
                matchedFiles.add(hit.path)
                if (hits.length < maxResults) {
                    hits.push(hit)
                }
            }
        } finally {
            reader.close()
        }
    })()

    const exitPromise = new Promise<{
        code: number | null
        signal: string | null
    }>((resolve, reject) => {
        child.on("error", reject)
        child.on("close", (code, closeSignal) => {
            resolve({ code, signal: closeSignal })
        })
    })

    try {
        const [exit] = await Promise.all([
            exitPromise,
            stdoutPromise,
            stderrPromise,
        ])

        if (signal?.aborted || exit.signal) {
            throw new Error("project_search was cancelled")
        }

        if (exit.code !== 0 && exit.code !== 1) {
            const message = cleanStderr(stderr)
            throw new Error(message || `rg exited with code ${exit.code}`)
        }

        return {
            hits,
            totalHits,
            totalFiles: matchedFiles.size,
            stderr,
            rgArgs: args,
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new Error("ripgrep (`rg`) is not installed or not on PATH")
        }
        throw error
    } finally {
        signal?.removeEventListener("abort", onAbort)
    }
}

export default function (pi: ExtensionAPI) {
    pi.registerTool({
        name: "project_search",
        label: "Project Search",
        description:
            "Search the current project with ripgrep. Returns grouped file/line matches and stays scoped to the current project root by default.",
        promptSnippet:
            "Search the current project with ripgrep and return grouped file/line matches",
        promptGuidelines: [
            "Prefer project_search over raw bash when you need to find symbols, strings, or regex matches in the project.",
            "Use read after project_search when you need surrounding code or full file contents.",
        ],
        parameters: PROJECT_SEARCH_PARAMS,

        async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
            const params = rawParams as ProjectSearchInput
            if (!params.query || !params.query.trim()) {
                throw new Error("project_search requires a non-empty query")
            }

            const maxResults = clampMaxResults(params.maxResults)
            const scope = resolveSearchScope(ctx.cwd, params.path)

            const args = [
                "--json",
                "--line-number",
                "--column",
                "--sort",
                "path",
            ]

            if (params.fixedStrings) {
                args.push("--fixed-strings")
            }
            if (params.caseSensitive) {
                args.push("--case-sensitive")
            } else {
                args.push("--smart-case")
            }
            if (params.hidden) {
                args.push("--hidden")
            }
            if (params.noIgnore) {
                args.push("--no-ignore")
            }
            if (params.glob) {
                args.push("--glob", params.glob)
            }

            args.push(params.query, scope.searchPath)

            const run = await runRipgrep(scope.cwd, args, signal, maxResults)
            const fullText = buildResultText(
                params,
                scope.displayScope,
                run,
                maxResults,
            )
            const truncation = truncateForTool(fullText)

            let resultText = truncation.content
            let fullOutputPath: string | undefined

            if (truncation.truncated) {
                fullOutputPath = writeFullOutput(fullText)
                resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatBytes(truncation.outputBytes)} of ${formatBytes(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`
            }

            return {
                content: [{ type: "text", text: resultText }],
                details: {
                    query: params.query,
                    path: scope.displayScope,
                    glob: params.glob,
                    fixedStrings: Boolean(params.fixedStrings),
                    caseSensitive: Boolean(params.caseSensitive),
                    hidden: Boolean(params.hidden),
                    noIgnore: Boolean(params.noIgnore),
                    maxResults,
                    totalHits: run.totalHits,
                    returnedHits: run.hits.length,
                    totalFiles: run.totalFiles,
                    rgArgs: run.rgArgs,
                    truncated: truncation.truncated,
                    fullOutputPath,
                },
            }
        },
    })
}

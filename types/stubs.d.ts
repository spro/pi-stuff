declare module "@mariozechner/pi-coding-agent" {
    export type SessionEntry = any
    export type ToolResultEvent = any

    export interface ExtensionUI {
        custom<T = unknown>(render: (...args: any[]) => any): Promise<T>
        notify(message: string, level?: string): void
        input(prompt: string): Promise<string>
        confirm(title: string, message?: string): Promise<boolean>
        [key: string]: any
    }

    export interface ExtensionContext {
        cwd: string
        hasUI?: boolean
        ui: ExtensionUI
        sessionManager: any
        model: any
        modelRegistry: any
        getSystemPrompt(): string
        getContextUsage(): { tokens?: number; contextWindow?: number } | null
        [key: string]: any
    }

    export interface ExtensionCommandContext extends ExtensionContext {}

    export interface ExtensionAPI {
        on(event: string, handler: (...args: any[]) => any): void
        registerTool(tool: any): void
        registerCommand(name: string, command: any): void
        registerShortcut?(name: string, shortcut: any): void
        appendEntry<T = unknown>(type: string, data: T): void
        getCommands(): any[]
        getAllTools(): Array<{ name: string; description?: string }>
        getActiveTools(): string[]
        sendMessage(message: any, options?: any): void
        exec?(command: string, ...args: any[]): Promise<any>
        [key: string]: any
    }

    export class DynamicBorder {
        constructor(renderer?: (...args: any[]) => any)
    }

    export class BorderedLoader {
        signal?: AbortSignal
        onAbort?: () => void
        constructor(...args: any[])
    }
}

declare module "@mariozechner/pi-tui" {
    export interface Component {
        render?(width: number, height?: number): string[]
        handleInput?(data: string): void
        invalidate?(): void
    }

    export interface TUI {
        width?: number
        height?: number
        requestRender(...args: any[]): void
        start(...args: any[]): void
        stop(...args: any[]): void
    }

    export interface SelectItem<T = string> {
        value: T
        label: string
        description?: string
    }

    export class Container {
        constructor(...args: any[])
        addChild(child: any): void
        removeChild?(child: any): void
        clear(): void
        invalidate(): void
        render(width: number, height?: number): string[]
    }

    export class Text {
        constructor(text?: string, x?: number, y?: number)
        setText(text: string): void
    }

    export class Input {
        constructor(...args: any[])
        value: string
        getValue(): string
        focus(): void
        handleInput(data: string): void
    }

    export class Spacer {
        constructor(size?: number)
    }

    export class SelectList<T = any> {
        onSelect?: (item: SelectItem<T>) => void
        onCancel?: () => void
        constructor(
            items?: Array<SelectItem<T>>,
            visibleRows?: number,
            options?: any,
        )
        setItems(items: Array<SelectItem<T>>): void
        setSelectedIndex(index: number): void
        focus(): void
        handleInput(data: string): void
        getSelected(): SelectItem<T> | null
        getSelectedItem(): SelectItem<T> | null
    }

    export const Key: {
        escape: string
        tab: string
        left: string
        right: string
        up: string
        down: string
        ctrl(key: string): string
        shift(key: string): string
    }

    export function matchesKey(input: string, key: string): boolean
    export function fuzzyFilter<T>(
        items: T[],
        query: string,
        extractor?: (item: T) => string,
    ): T[]
    export function sliceByColumn(
        text: string,
        start: number,
        end?: number,
        ansi?: boolean,
    ): string
    export function truncateToWidth(text: string, width: number): string
    export function visibleWidth(text: string): number
    export function getEditorKeybindings(): any
}

declare module "@mariozechner/pi-ai" {
    export function complete(...args: any[]): Promise<any>
}

declare module "@sinclair/typebox" {
    export const Type: {
        Object(...args: any[]): any
        String(...args: any[]): any
    }
}

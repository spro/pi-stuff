import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const GRILL_PROMPT = `Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

If a question can be answered by exploring the codebase, explore the codebase instead.

Do not solve or implement the plan yet. Do not give recommendations yet unless I explicitly ask for them. Your job right now is to ask a focused series of questions that clarifies the plan.

Here is the plan to interrogate:
`;

export default function grillExtension(pi: ExtensionAPI) {
	pi.registerCommand("grill", {
		description: "Turn a plan into a rigorous clarification interview",
		handler: async (args, ctx) => {
			const plan = args.trim();
			if (!plan) {
				ctx.ui.notify("Usage: /grill <plan>", "warning");
				return;
			}

			const message = `${GRILL_PROMPT}<plan>\n${plan}\n</plan>`;

			if (ctx.isIdle()) {
				pi.sendUserMessage(message);
				return;
			}

			pi.sendUserMessage(message, { deliverAs: "followUp" });
			ctx.ui.notify("Queued /grill as a follow-up", "info");
		},
	});
}

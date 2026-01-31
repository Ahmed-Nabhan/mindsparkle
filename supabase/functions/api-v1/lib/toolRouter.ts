export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ToolName = "web_search" | "document_extract" | "image_generate" | "none";

export type ToolRoute = {
  tool: ToolName;
  reason: string;
};

const imageRe = /(generate|create|make|draw)\s+(an\s+)?(image|picture|photo|illustration|logo|icon)/i;
const docRe = /(summarize|explain|analyze|extract|ocr|read)\s+(this\s+)?(pdf|document|file|attachment)/i;
const webRe = /(latest|news|today|current|search the web|browse|find sources|citations?)/i;

export function chooseTool(messages: ChatMessage[], hintedTool?: ToolName): ToolRoute {
  if (hintedTool && hintedTool !== "none") {
    return { tool: hintedTool, reason: "client_hint" };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const content = lastUser?.content ?? "";

  if (imageRe.test(content)) return { tool: "image_generate", reason: "matched_image_intent" };
  if (docRe.test(content)) return { tool: "document_extract", reason: "matched_doc_intent" };
  if (webRe.test(content)) return { tool: "web_search", reason: "matched_web_intent" };

  return { tool: "none", reason: "default" };
}

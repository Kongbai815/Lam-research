import { getUserAiSettingsForRequest } from "./auth";

interface ChatMessage {
  role: "assistant" | "user" | "system";
  content: string;
}

interface AiChatRequest {
  provider?: "gpt" | "gemini" | "claude" | "custom";
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
  messages: ChatMessage[];
  context?: string;
}

interface AiRuntimeSettings {
  provider?: AiChatRequest["provider"];
  apiBaseUrl?: string;
  apiKey?: string;
  model?: string;
}

function jsonResponse(res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

function responseText(data: any) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  const parts = Array.isArray(data?.output)
    ? data.output.flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    : [];
  const text = parts.map((part: any) => part?.text || part?.content?.[0]?.text).filter(Boolean).join("\n");
  return text || "";
}

function usesOpenAiResponses(model: string) {
  return new Set(["gpt-5.2-pro", "gpt-5.2-codex", "gpt-5-pro"]).has(model);
}

function defaultAiSettings(): AiRuntimeSettings {
  const provider = (process.env.DEFAULT_AI_PROVIDER || "gpt") as AiChatRequest["provider"];
  return {
    provider,
    apiBaseUrl: process.env.DEFAULT_AI_API_BASE_URL || (provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : provider === "claude" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
    model: process.env.DEFAULT_AI_MODEL || (provider === "gemini" ? "gemini-2.5-flash" : provider === "claude" ? "claude-sonnet-4-20250514" : "gpt-5.2"),
    apiKey: process.env.DEFAULT_AI_API_KEY || process.env.OPENAI_API_KEY || "",
  };
}

function resolveRuntimeRequest(request: AiChatRequest, accountSettings?: AiRuntimeSettings): AiChatRequest {
  const defaults = defaultAiSettings();
  const provider = request.provider || accountSettings?.provider || defaults.provider || "gpt";
  const apiKey = request.apiKey?.trim() || accountSettings?.apiKey?.trim() || defaults.apiKey?.trim() || "";
  if (!apiKey) {
    throw new Error("No AI API key is configured. Add a key in Settings, save it to your account, or set DEFAULT_AI_API_KEY/OPENAI_API_KEY on the server.");
  }
  return {
    ...request,
    provider,
    apiBaseUrl: request.apiBaseUrl?.trim() || accountSettings?.apiBaseUrl?.trim() || defaults.apiBaseUrl,
    model: request.model?.trim() || accountSettings?.model?.trim() || defaults.model,
    apiKey,
  };
}

async function callOpenAiResponses(request: AiChatRequest, model: string, baseUrl: string) {
  const apiKey = request.apiKey?.trim();
  if (!apiKey) throw new Error("Missing API key.");
  const endpoint = `${baseUrl}/responses`;
  const instructions = [
    "You are ResearchAI, an academic search assistant. Be concise, practical, and grounded in the supplied researcher context.",
    request.context || "",
    ...request.messages.filter((message) => message.role === "system").map((message) => message.content),
  ].filter(Boolean).join("\n\n");
  const input = request.messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, instructions, input }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `AI request failed with HTTP ${response.status}.`);
  const content = responseText(data);
  if (!content) throw new Error("AI response did not include a message.");
  return content as string;
}

async function callOpenAiCompatible(request: AiChatRequest) {
  const apiKey = request.apiKey?.trim();
  if (!apiKey) throw new Error("Missing API key.");
  const baseUrl = normalizeBaseUrl(request.apiBaseUrl, "https://api.openai.com/v1");
  const model = request.model?.trim() || "gpt-5.2";
  if (usesOpenAiResponses(model)) return callOpenAiResponses(request, model, baseUrl);
  const endpoint = `${baseUrl}/chat/completions`;
  const messages = [
    { role: "system", content: "You are ResearchAI, an academic search assistant. Be concise, practical, and grounded in the supplied researcher context." },
    ...(request.context ? [{ role: "system" as const, content: request.context }] : []),
    ...request.messages,
  ];
  const body: Record<string, unknown> = { model, messages };
  if (!/^gpt-5/i.test(model)) body.temperature = 0.3;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `AI request failed with HTTP ${response.status}.`);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI response did not include a message.");
  return content as string;
}

async function callGemini(request: AiChatRequest) {
  const apiKey = request.apiKey?.trim();
  if (!apiKey) throw new Error("Missing API key.");
  const model = request.model?.trim() || "gemini-2.5-flash";
  const baseUrl = normalizeBaseUrl(request.apiBaseUrl, "https://generativelanguage.googleapis.com/v1beta");
  const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const prompt = [
    "You are ResearchAI, an academic search assistant. Be concise, practical, and grounded in the supplied researcher context.",
    request.context || "",
    ...request.messages.map((message) => `${message.role}: ${message.content}`),
  ].filter(Boolean).join("\n\n");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed with HTTP ${response.status}.`);
  const content = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text).filter(Boolean).join("\n");
  if (!content) throw new Error("Gemini response did not include text.");
  return content as string;
}

async function callClaude(request: AiChatRequest) {
  const apiKey = request.apiKey?.trim();
  if (!apiKey) throw new Error("Missing API key.");
  const model = request.model?.trim() || "claude-sonnet-4-20250514";
  const baseUrl = normalizeBaseUrl(request.apiBaseUrl, "https://api.anthropic.com/v1");
  const endpoint = `${baseUrl}/messages`;
  const system = [
    "You are ResearchAI, an academic search assistant. Be concise, practical, and grounded in the supplied researcher context.",
    request.context || "",
    ...request.messages.filter((message) => message.role === "system").map((message) => message.content),
  ].filter(Boolean).join("\n\n");
  const messages = request.messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Claude request failed with HTTP ${response.status}.`);
  const content = data?.content?.map((part: { type?: string; text?: string }) => part.type === "text" ? part.text : "").filter(Boolean).join("\n");
  if (!content) throw new Error("Claude response did not include text.");
  return content as string;
}

export async function resolveAiChat(request: AiChatRequest, accountSettings?: AiRuntimeSettings) {
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error("At least one chat message is required.");
  }
  const resolved = resolveRuntimeRequest(request, accountSettings);
  if (resolved.provider === "gemini") return callGemini(resolved);
  if (resolved.provider === "claude") return callClaude(resolved);
  return callOpenAiCompatible(resolved);
}

export async function handleAiChatRequest(req: any, body: unknown, res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body: string) => void }) {
  try {
    const answer = await resolveAiChat(body as AiChatRequest, getUserAiSettingsForRequest(req));
    jsonResponse(res, 200, { answer });
  } catch (error) {
    jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

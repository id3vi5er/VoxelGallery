import { invoke } from "@tauri-apps/api/core";
import { buildSystemPrompt, buildUserPrompt, parseGeneratedJson, VOXEL_JSON_SCHEMA } from "./schema";
import type { LlmConfig, PromptOptions, SceneParseResult } from "./types";

interface HttpResponse {
  status: number;
  body: string;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<HttpResponse> {
  return invoke<HttpResponse>("llm_http_request", { request: { url, headers, body: JSON.stringify(body) } });
}

function requireKey(config: LlmConfig, provider: string): string {
  if (!config.apiKey.trim()) throw new Error(`Bitte einen ${provider}-API-Key eintragen.`);
  return config.apiKey.trim();
}

function parseResponse(response: HttpResponse, provider: string): unknown {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${provider}-Anfrage fehlgeschlagen (${response.status}): ${response.body.slice(0, 300)}`);
  }
  try { return JSON.parse(response.body); }
  catch { throw new Error(`${provider} hat keine gültige JSON-Antwort geliefert.`); }
}

async function generateWithOpenAi(prompt: string, system: string, config: LlmConfig, options: PromptOptions): Promise<SceneParseResult> {
  const response = await postJson("https://api.openai.com/v1/responses", {
    "Content-Type": "application/json", Authorization: `Bearer ${requireKey(config, "OpenAI")}`,
  }, {
    model: config.model,
    input: [{ role: "system", content: system }, { role: "user", content: prompt }],
    text: { format: { type: "json_schema", name: "voxel_scene", strict: true, schema: VOXEL_JSON_SCHEMA } },
    max_output_tokens: 30_000,
  });
  const data = parseResponse(response, "OpenAI") as any;
  const text = data.output_text ?? data.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.type === "output_text")?.text;
  if (typeof text !== "string") throw new Error("OpenAI hat keine JSON-Textausgabe geliefert.");
  return parseGeneratedJson(text, options.size);
}

async function generateWithAnthropic(prompt: string, system: string, config: LlmConfig, options: PromptOptions): Promise<SceneParseResult> {
  const response = await postJson("https://api.anthropic.com/v1/messages", {
    "Content-Type": "application/json", "x-api-key": requireKey(config, "Anthropic"), "anthropic-version": "2023-06-01",
  }, { model: config.model, max_tokens: 30_000, system, messages: [{ role: "user", content: prompt }] });
  const data = parseResponse(response, "Claude") as any;
  const text = data.content?.find((item: any) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error("Claude hat keine JSON-Textausgabe geliefert.");
  return parseGeneratedJson(text, options.size);
}

async function generateWithGemini(prompt: string, system: string, config: LlmConfig, options: PromptOptions): Promise<SceneParseResult> {
  const model = encodeURIComponent(config.model);
  const response = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    "Content-Type": "application/json", "x-goog-api-key": requireKey(config, "Google AI"),
  }, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: VOXEL_JSON_SCHEMA, maxOutputTokens: 30_000, temperature: 0.35 },
  });
  const data = parseResponse(response, "Gemini") as any;
  const text = data.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("");
  if (typeof text !== "string" || !text) throw new Error("Gemini hat keine JSON-Textausgabe geliefert.");
  return parseGeneratedJson(text, options.size);
}

async function generateWithCompatible(prompt: string, system: string, config: LlmConfig, options: PromptOptions): Promise<SceneParseResult> {
  const endpoint = config.endpoint.trim();
  if (!endpoint) throw new Error("Bitte einen API-Endpunkt eintragen.");
  const response = await postJson(endpoint, {
    "Content-Type": "application/json", ...(config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey.trim()}` } : {}),
  }, {
    model: config.model, temperature: 0.35, response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
  });
  const data = parseResponse(response, "LLM") as any;
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Der Endpunkt hat keine Textantwort geliefert.");
  return parseGeneratedJson(text, options.size);
}

export async function generateWithLlm(userPrompt: string, config: LlmConfig, options: PromptOptions): Promise<SceneParseResult> {
  const system = buildSystemPrompt(options);
  const prompt = buildUserPrompt(userPrompt, options);
  if (config.mode === "openai") return generateWithOpenAi(prompt, system, config, options);
  if (config.mode === "anthropic") return generateWithAnthropic(prompt, system, config, options);
  if (config.mode === "gemini") return generateWithGemini(prompt, system, config, options);
  return generateWithCompatible(prompt, system, config, options);
}

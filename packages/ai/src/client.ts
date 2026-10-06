/**
 * Public entry for LLM access. Jobs depend only on the provider-neutral types in ./llm;
 * the concrete providers and the factory are re-exported here for the app and tests.
 */
export * from "./llm";
export * from "./factory";
export { GeminiClient, type GeminiClientOptions, type GeminiSdk } from "./providers/gemini";
export { ClaudeClient, type ClaudeClientOptions } from "./providers/anthropic";

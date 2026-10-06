import type { AiRunSink, LlmClient } from "./llm";
import { currentProvider, type Provider } from "./models";
import { ClaudeClient } from "./providers/anthropic";
import { GeminiClient } from "./providers/gemini";

export interface CreateLlmClientOptions {
  sink?: AiRunSink;
  /** Defaults to MCA_AI_PROVIDER, which defaults to "gemini". */
  provider?: Provider;
}

/** The one place the app chooses a provider. */
export function createLlmClient(opts: CreateLlmClientOptions = {}): LlmClient {
  const provider = opts.provider ?? currentProvider();
  const sink = opts.sink ?? (() => undefined);
  return provider === "anthropic"
    ? new ClaudeClient({ sink, enableFallbacks: true })
    : new GeminiClient({ sink });
}

/** Name of the env var holding the key for the active provider (for health checks). */
export function apiKeyEnvVar(provider: Provider = currentProvider()): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
}

import { afterEach, describe, expect, it } from "vitest";
import { apiKeyEnvVar, createLlmClient } from "./factory";
import { MODELS } from "./models";

afterEach(() => {
  delete process.env.MCA_AI_PROVIDER;
});

describe("createLlmClient", () => {
  it("defaults to Gemini", () => {
    delete process.env.MCA_AI_PROVIDER;
    expect(createLlmClient().provider).toBe("gemini");
    expect(apiKeyEnvVar()).toBe("GEMINI_API_KEY");
    expect(MODELS.primary).toBe("gemini-3.1-pro-preview");
    expect(MODELS.fast).toBe("gemini-3-flash-preview");
  });

  it("switches to Anthropic with MCA_AI_PROVIDER=anthropic", () => {
    process.env.MCA_AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY ??= "test-key";
    expect(createLlmClient().provider).toBe("anthropic");
    expect(apiKeyEnvVar()).toBe("ANTHROPIC_API_KEY");
    expect(MODELS.primary).toBe("claude-opus-5-5");
  });

  it("lets the caller force a provider", () => {
    process.env.MCA_AI_PROVIDER = "anthropic";
    expect(createLlmClient({ provider: "gemini" }).provider).toBe("gemini");
  });
});

import { describe, it, expect } from "vitest";
import { convertResponsesStreamToJson } from "../../open-sse/transformer/streamToJsonConverter.js";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

describe("Responses stream usage", () => {
  it("preserves cached and reasoning token details from terminal usage", async () => {
    const terminal = {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          total_tokens: 1200,
          input_tokens_details: { cached_tokens: 600 },
          output_tokens_details: { reasoning_tokens: 150 },
        },
      },
    };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `event: response.completed\ndata: ${JSON.stringify(terminal)}\n\n`
        ));
        controller.close();
      },
    });

    const response = await convertResponsesStreamToJson(stream);

    expect(response.usage.input_tokens_details.cached_tokens).toBe(600);
    expect(response.usage.output_tokens_details.reasoning_tokens).toBe(150);
    expect(canonicalizeUsage(response.usage)).toMatchObject({
      cached_tokens: 600,
      reasoning_tokens: 150,
    });
  });

  it("preserves top-level cached and reasoning token fields", async () => {
    const terminal = {
      type: "response.completed",
      response: {
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          total_tokens: 1200,
          cached_tokens: 600,
          reasoning_tokens: 150,
        },
      },
    };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `event: response.completed\ndata: ${JSON.stringify(terminal)}\n\n`
        ));
        controller.close();
      },
    });

    const response = await convertResponsesStreamToJson(stream);

    expect(canonicalizeUsage(response.usage)).toMatchObject({
      cached_tokens: 600,
      reasoning_tokens: 150,
    });
  });

  it("extracts cached tokens from a non-streaming Responses body", () => {
    expect(extractUsageFromResponse({
      object: "response",
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        input_tokens_details: { cached_tokens: 600 },
        output_tokens_details: { reasoning_tokens: 150 },
      },
    })).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 200,
      cached_tokens: 600,
      reasoning_tokens: 150,
    });
  });

  it("extracts top-level token details from a non-streaming Responses body", () => {
    expect(extractUsageFromResponse({
      object: "response",
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cached_tokens: 600,
        reasoning_tokens: 150,
      },
    })).toMatchObject({
      cached_tokens: 600,
      reasoning_tokens: 150,
    });
  });

  it("does not misclassify Claude usage with detail fields", () => {
    expect(extractUsageFromResponse({
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 60,
        cache_creation_input_tokens: 10,
        input_tokens_details: {},
      },
    })).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 20,
      cache_read_input_tokens: 60,
      cache_creation_input_tokens: 10,
    });
  });
});

import {
  ValidationError,
  RateLimitError,
  buildOptimizePrompt,
  parseDelimitedResponse,
  resolveProviderConfig,
  streamCompletion,
  enforceHostedRateLimit,
  validateImage,
  buildUserContent,
} from "../../_lib/optimizer.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const rawPrompt = String(body.prompt || "").trim();
  if (!rawPrompt) return json({ ok: false, error: "prompt is required" }, 400);
  if (rawPrompt.length > 30000) {
    return json({ ok: false, error: "Prompt too long (max 30,000 characters)" }, 400);
  }
  if (body.depth === "deep") {
    return json({ ok: false, error: "Deep mode is not supported on the streaming endpoint." }, 400);
  }

  let systemPrompt, userText, config;
  try {
    if (!String(body.api_key || "").trim()) await enforceHostedRateLimit(env, request);
    ({ systemPrompt, userText } = buildOptimizePrompt(body, rawPrompt));
    if (body.image) {
      validateImage(body.image);
      userText = buildUserContent(userText, body.image);
    }
    config = await resolveProviderConfig(body, env);
  } catch (e) {
    if (e instanceof ValidationError) return json({ ok: false, error: e.message }, 400);
    if (e instanceof RateLimitError) return json({ ok: false, error: e.message }, 429);
    throw e;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const fullText = [];
      try {
        const { truncated, model, usage } = await streamCompletion(config, systemPrompt, userText, 4000, (piece) => {
          fullText.push(piece);
          send("chunk", { text: piece });
        }, request.signal);
        if (truncated) {
          send("error", {
            error: "The model's response was cut off before it finished. Try a shorter prompt or a different model.",
          });
        } else {
          const { optimizedText, explanationText } = parseDelimitedResponse(fullText.join(""));
          send("done", { optimized_prompt: optimizedText, explanation: explanationText, model, usage });
        }
      } catch (e) {
        if (request.signal?.aborted) {
          try { controller.close(); } catch (closeErr) {}
          return;
        }
        send("error", { error: e.message || "Optimization failed." });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

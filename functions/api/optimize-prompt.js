import {
  ValidationError,
  RateLimitError,
  buildOptimizePrompt,
  buildRefinePassPrompt,
  parseDelimitedResponse,
  resolveProviderConfig,
  callCompletion,
  enforceHostedRateLimit,
  validateImage,
  buildUserContent,
} from "../_lib/optimizer.js";

export async function onRequestGet({ env }) {
  try {
    const config = await resolveProviderConfig({}, env);
    const first = config.attempts[0];
    return json({ ok: true, provider: first.provider || null, model: first.model || null, source: config.source });
  } catch (e) {
    return json({ ok: true, provider: null, model: null, source: "none" });
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const rawPrompt = String(body.prompt || "").trim();
  const previousPrompt = String(body.previous_prompt || "").trim();
  const refinementInstruction = String(body.refinement_instruction || "").trim();
  const isRefinement = Boolean(previousPrompt && refinementInstruction);

  if (!isRefinement && !rawPrompt) {
    return json({ ok: false, error: "prompt is required" }, 400);
  }
  if (rawPrompt.length > 30000 || previousPrompt.length > 30000) {
    return json({ ok: false, error: "Prompt too long (max 30,000 characters)" }, 400);
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

  try {
    let { content, truncated, model, usage } = await callCompletion(config, systemPrompt, userText, 4000, request.signal);
    if (truncated) {
      return json(
        { ok: false, error: "The model's response was cut off before it finished. Try a shorter prompt or a different model." },
        502
      );
    }
    let { optimizedText, explanationText } = parseDelimitedResponse(content);

    if (body.depth === "deep" && optimizedText) {
      try {
        const refineParams = buildRefinePassPrompt(rawPrompt, optimizedText);
        const secondResult = await callCompletion(config, refineParams.systemPrompt, refineParams.userText, 4000, request.signal);
        if (secondResult.truncated) {
          return json(
            { ok: false, error: "The model's response was cut off during the second critique pass. Try a shorter prompt or a different model." },
            502
          );
        }
        const secondParsed = parseDelimitedResponse(secondResult.content);
        optimizedText = secondParsed.optimizedText;
        explanationText = secondParsed.explanationText;
        model = secondResult.model;
        if (secondResult.usage) {
          if (!usage) usage = { prompt_tokens: 0, completion_tokens: 0 };
          usage.prompt_tokens = (usage.prompt_tokens || 0) + (secondResult.usage.prompt_tokens || 0);
          usage.completion_tokens = (usage.completion_tokens || 0) + (secondResult.usage.completion_tokens || 0);
        }
      } catch (refineError) {
        console.error("Second critique/refinement pass failed, falling back to first-pass result:", refineError);
      }
    }

    return json({ ok: true, optimized_prompt: optimizedText, explanation: explanationText, model, usage });
  } catch (e) {
    return json({ ok: false, error: e.message || "Optimization failed." }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

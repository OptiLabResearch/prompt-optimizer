// Shared prompt-building, response-parsing, and LLM-calling logic for the
// prompt optimizer API. Ported from hermes-webui's api/routes.py so this
// project can run standalone (no hermes-webui backend dependency).

export const PROVIDER_PRESETS = {
  groq: {
    label: "Groq",
    mode: "chat",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  openrouter: {
    label: "OpenRouter",
    mode: "chat",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
  },
  nvidia: {
    label: "NVIDIA NIM",
    mode: "chat",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "minimaxai/minimax-m3",
  },
  google: {
    label: "Google Gemini",
    mode: "chat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-3.5-flash",
  },
  openai: {
    label: "OpenAI",
    mode: "chat",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5-4-mini",
  },
  anthropic: {
    label: "Anthropic",
    mode: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-haiku-4-5-20251001",
  },
  xai: {
    label: "xAI",
    mode: "chat",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.3",
  },
  "opencode-go": {
    label: "Opencode Go",
    mode: "chat",
    baseUrl: "https://opencode.ai/zen/go/v1",
    defaultModel: "opencode-go/kimi-k2.7-code",
  },
  "opencode-zen": {
    label: "Opencode Zen",
    mode: "chat",
    baseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "opencode/gpt-5.5",
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    mode: "chat",
    baseUrl: "",
    defaultModel: "",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    mode: "chat",
    baseUrl: "",
    defaultModel: "",
  },
};

const TARGET_MODEL_GUIDELINES = {
  claude:
    "Target model: Anthropic Claude. XML tags as the native delimiter dialect " +
    "(<task>, <rules>, <document>, <example>); long documents at top in <document> " +
    "wrappers, query/instructions at bottom; do NOT rely on assistant-prefill tricks " +
    "(deprecated); role via system prompt is a strong lever; note newer Claude models " +
    "are concise by default — ask for summaries explicitly if visibility is wanted. " +
    "If the target is a modern reasoning model, do not add 'think step by step' — " +
    "reasoning is controlled by a budget parameter, not prompt text.",
  gpt:
    "Target model: OpenAI GPT. Structure the prompt with markdown headers and lists " +
    "rather than XML tags; outcome-first is official doctrine; GPT-5.x follows " +
    "instructions literally — be specific, define stopping rules; keep personality/tone " +
    "separate from decision rules; mention verbosity/output-contract blocks. " +
    "If the target is a modern reasoning model, do not add 'think step by step' — " +
    "reasoning is controlled by a budget parameter, not prompt text.",
  gemini:
    "Target model: Google Gemini. Clear sectioning (markdown or XML both fine); for " +
    "long-context, data first and query last; don't hand-write CoT — thinking budget is " +
    "a parameter. If the target is a modern reasoning model, do not add 'think step by step' — " +
    "reasoning is controlled by a budget parameter, not prompt text.",
  local:
    "Target model: a small local/open-weight model. Keep the prompt short, simple, and direct — " +
    "avoid deeply nested structure, long context, or many simultaneous constraints, since small " +
    "models follow simple instructions far more reliably than complex ones. Manual chain-of-thought " +
    "(\"reason step by step before answering\") IS still useful here since small non-reasoning models " +
    "benefit from it. If the target is a modern reasoning model, do not add 'think step by step' — " +
    "reasoning is controlled by a budget parameter, not prompt text.",
  generic:
    "Target model: unspecified/generic. Portable architecture (role, context, ordered rules or " +
    "outcome definition, output schema, examples) with widely-compatible markdown structure; " +
    "note the delimiter dialect can be swapped per provider. If the target is a modern reasoning " +
    "model, do not add 'think step by step' — reasoning is controlled by a budget parameter, not prompt text.",
};

const STRENGTH_GUIDELINES = {
  concise: "Keep the optimized prompt extremely focused, concise, and direct. Eliminate all fluff.",
  detailed: "Be highly detailed. Expand the prompt to include clear context, comprehensive instructions, edge cases, and constraints.",
  balanced: "Strike an optimal balance between conciseness, instruction clarity, and contextual detail.",
};

// Controls the literal output length of the rewritten prompt, independent of
// STRENGTH_GUIDELINES above (which governs structural balance, not word count).
const LENGTH_GUIDELINES = {
  concise: "Keep the rewritten prompt itself short and tight — roughly the same length as the raw input, favoring brevity over exhaustive structure even if that means omitting optional sections.",
  standard: "Keep the rewritten prompt's overall length proportionate to the input — expand only what's needed for clarity, not for its own sake.",
  full: "Expand the rewritten prompt with comprehensive context, detailed step-by-step instructions, edge cases, and constraints wherever they add value.",
};

const TECHNIQUE_GUIDELINES = {
  cot: "", // Handled dynamically in buildOptimizePrompt based on targetModel
  fewshot: "Include 2–3 curated, contrastive examples that cover edge cases, including one near-miss negative example annotated with why it's wrong. Examples must be consistent with every stated rule — examples override instructions when they conflict.",
  xml: "Structure the prompt's sections with XML tags (e.g. <context>, <task>, <constraints>) for clarity, using XML as the delimiter dialect regardless of target-model default.",
  placeholders: "Use variable placeholders in the form {{like_this}} for values that should be filled in dynamically, putting input-data placeholders where the data belongs (long reference at top, query at bottom).",
};

export class ValidationError extends Error {}
export class RateLimitError extends Error {}

const RATE_LIMIT_CACHE_PREFIX = "https://prompt-optimizer.local/ratelimit-";
const RATE_LIMIT_MINUTE_WINDOW_SECONDS = 60;
const RATE_LIMIT_MINUTE_MAX = 5;
const RATE_LIMIT_HOUR_WINDOW_SECONDS = 3600;
const RATE_LIMIT_HOUR_MAX = 20;
const RATE_LIMIT_LOCKOUT_SECONDS = 5 * 3600;

const BYOK_HINT = "or add your own free API key in Settings — visit https://freellm.net/ for a list of current free-tier LLM API keys and instructions on how to get one.";

async function bumpRateLimitCount(cache, request, ttlSeconds) {
  const existing = await cache.match(request);
  let count = 0;
  if (existing) {
    const data = await existing.json().catch(() => ({ count: 0 }));
    count = data.count || 0;
  }
  count += 1;
  await cache.put(request, new Response(JSON.stringify({ count }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `max-age=${ttlSeconds}`,
    },
  }));
  return count;
}

// Two-tier per-IP abuse guard for requests that spend the site owner's shared
// hosted API keys (no body.api_key): a short burst cap plus a stricter hourly
// cap that, once tripped, locks the IP out for several hours rather than
// resetting on the next window. Uses the same Cache API mechanism as the
// circuit breaker above, so it needs no extra bindings; fails open if the
// Cache API isn't available (e.g. local dev) or errors.
export async function enforceHostedRateLimit(env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  try {
    if (typeof caches === "undefined" || !caches.default) return;
    const cache = caches.default;

    const lockoutReq = new Request(`${RATE_LIMIT_CACHE_PREFIX}lockout-${ip}`);
    if (await cache.match(lockoutReq)) {
      throw new RateLimitError(
        `You've hit the shared free-key hourly limit and are temporarily paused. Please wait a few hours, ${BYOK_HINT}`
      );
    }

    const minuteWindow = Math.floor(Date.now() / (RATE_LIMIT_MINUTE_WINDOW_SECONDS * 1000));
    const hourWindow = Math.floor(Date.now() / (RATE_LIMIT_HOUR_WINDOW_SECONDS * 1000));
    const minuteReq = new Request(`${RATE_LIMIT_CACHE_PREFIX}min-${ip}-${minuteWindow}`);
    const hourReq = new Request(`${RATE_LIMIT_CACHE_PREFIX}hour-${ip}-${hourWindow}`);

    const [minuteCount, hourCount] = await Promise.all([
      bumpRateLimitCount(cache, minuteReq, RATE_LIMIT_MINUTE_WINDOW_SECONDS),
      bumpRateLimitCount(cache, hourReq, RATE_LIMIT_HOUR_WINDOW_SECONDS),
    ]);

    if (hourCount > RATE_LIMIT_HOUR_MAX) {
      await cache.put(lockoutReq, new Response("1", {
        headers: { "Cache-Control": `max-age=${RATE_LIMIT_LOCKOUT_SECONDS}` },
      }));
      throw new RateLimitError(
        `You've hit the shared free-key hourly limit. Please wait a few hours, ${BYOK_HINT}`
      );
    }

    if (minuteCount > RATE_LIMIT_MINUTE_MAX) {
      throw new RateLimitError(
        `Too many requests — please slow down and try again in a minute, ${BYOK_HINT}`
      );
    }
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    // Fail open on cache errors so the rate limiter itself never breaks the app.
  }
}

export function buildRefinementPrompt(body) {
  const previousPrompt = String(body.previous_prompt || "").trim();
  const refinementInstruction = String(body.refinement_instruction || "").trim();
  const systemPrompt =
    "You are an expert Prompt Engineer. The user has an already-optimized prompt and wants a " +
    "targeted revision, not a from-scratch rewrite. Apply ONLY the requested change while " +
    "preserving everything else about the prompt's structure, persona, and intent. " +
    "When applying the revision, keep the prompt aligned with modern best practice " +
    "(outcome-first, delimited data, output contract); do not reintroduce step-by-step " +
    "micromanagement or 'think step by step' boilerplate.\n\n" +
    "You MUST structure your entire response as exactly these two blocks, in this order,\n" +
    "with no text before, between, or after them:\n\n" +
    "<optimized_prompt>\n" +
    "The full prompt after applying the requested revision, in markdown format.\n" +
    "Organized into labeled sections using markdown '##' headers:\n" +
    "## Role\n" +
    "## Context\n" +
    "## Task\n" +
    "## Constraints\n" +
    "## Output Format\n" +
    "</optimized_prompt>\n" +
    "<explanation>\n" +
    "A short markdown bullet-point list of what changed and why.\n" +
    "Each bullet point MUST start with the bold section name it applies to (e.g. '**Role**: ...' or '**General**: ...').\n" +
    "</explanation>";
  const userText =
    `Current optimized prompt:\n${previousPrompt}\n\n` +
    `Requested revision: ${refinementInstruction}`;
  return { systemPrompt, userText };
}

export function buildCritiquePrompt(rawPrompt) {
  const systemPrompt =
    "You are an expert Prompt Engineer conducting a critique of a prompt — you do NOT rewrite it.\n" +
    "Evaluate the user's raw prompt through these four guide-aligned axes, scoring each from 1-10:\n" +
    "1. Outcome clarity (Is 'done' defined? Are success criteria, hard constraints, and output shape specified outcome-first?)\n" +
    "2. Structure & delimiting (Is there clear separation of data vs instructions? Is reference material at the top and the query at the bottom?)\n" +
    "3. Output contract (Is there an enforceable format, explicit schema, template, or strict length limits?)\n" +
    "4. Robustness (Are there anti-hallucination outs, explicit enums for classifications, and conditional decision rules over absolutes?)\n\n" +
    "Evaluate through each lens separately. At the end of the evaluation, list the top 3 highest-impact fixes, ordered by expected gain.\n\n" +
    "You MUST structure your entire response as exactly these two blocks, in this order,\n" +
    "with no text before, between, or after them:\n\n" +
    "<optimized_prompt>\n" +
    "Repeat the user's raw prompt here, verbatim and unchanged.\n" +
    "</optimized_prompt>\n" +
    "<explanation>\n" +
    "A markdown response with the four scores (out of 10) followed by the detailed evaluation through each lens, " +
    "and ending with the top 3 highest-impact fixes ordered by expected gain. Do not include a rewritten prompt here.\n" +
    "</explanation>";
  return { systemPrompt, userText: `Raw Prompt to Optimize:\n${rawPrompt}` };
}

export function buildStandardPrompt(body, rawPrompt) {
  const strength = String(body.strength || "balanced").trim().toLowerCase();
  const guideline = STRENGTH_GUIDELINES[strength] || STRENGTH_GUIDELINES.balanced;

  const targetModel = String(body.target_model || "").trim().toLowerCase();
  const requestedTechniques = Array.isArray(body.techniques) ? body.techniques : [];
  const techniqueLines = [];
  for (const t of requestedTechniques) {
    const techKey = String(t).trim().toLowerCase();
    if (techKey === "cot") {
      const line = targetModel === "local"
        ? "Add explicit step-by-step reasoning instructions (chain-of-thought) before giving the final answer."
        : "For modern reasoning models, note that reasoning effort should be set via the API's reasoning/thinking parameter rather than using 'think step by step' prompt text.";
      if (!techniqueLines.includes(line)) techniqueLines.push(line);
    } else {
      const line = TECHNIQUE_GUIDELINES[techKey];
      if (line && !techniqueLines.includes(line)) techniqueLines.push(line);
    }
  }

  let systemPrompt =
    "You are an expert prompt engineer (2026 practice). Rewrite the user's raw prompt into a\n" +
    "highly effective prompt. Apply these principles:\n\n" +
    "1. OUTCOME-FIRST: Define what \"done\" looks like — the expected outcome, success criteria,\n" +
    "   hard constraints, and output shape. Do NOT prescribe step-by-step procedures unless the\n" +
    "   raw prompt shows the exact path itself matters (compliance, fixed pipelines).\n" +
    "2. STRUCTURED ANATOMY: You MUST organize the optimized prompt into these specific labeled sections using markdown '##' headers:\n" +
    "   ## Role\n" +
    "   ## Context\n" +
    "   ## Task\n" +
    "   ## Constraints\n" +
    "   ## Output Format\n" +
    "   Only include sections that are relevant; do not add empty boilerplate sections.\n" +
    "3. DELIMIT DATA FROM INSTRUCTIONS: any user-supplied data, documents, or variable content\n" +
    "   goes in clearly delimited blocks. Long reference material at the top; the query and\n" +
    "   instructions at the bottom.\n" +
    "4. OUTPUT CONTRACT, not polite requests: exact format spec (schema, template, or explicit\n" +
    "   length limits like \"≤5 bullets\"). Prefer machine-checkable shapes.\n" +
    "5. DECISION RULES OVER ABSOLUTES: reserve ALWAYS/NEVER/MUST for true invariants; use\n" +
    "   \"If X then Y, otherwise Z\" conditional rules for judgment calls.\n" +
    "6. ANTI-HALLUCINATION: when the task involves extraction, facts, or classification, give\n" +
    "   the model an out (\"if absent, output null / say 'insufficient information' — never\n" +
    "   guess\") and constrain categorical outputs to explicit enums.\n" +
    "7. HIGH SIGNAL ONLY: aim for the smallest set of high-signal tokens that achieves the\n" +
    "   outcome. Cut filler like \"please\", \"world-class\", and restated obvious context.\n" +
    "8. PLACEHOLDERS: if the prompt will be reused with varying inputs, mark those spots as\n" +
    "   {{VARIABLES}} and put them where the data belongs (bottom for queries).\n\n" +
    `Optimization Requirement: ${guideline}\n`;

  if (techniqueLines.length) {
    systemPrompt += "\nAdditionally, incorporate these techniques:\n" +
      techniqueLines.map((l) => `- ${l}`).join("\n") + "\n";
  }

  const length = String(body.length || "standard").trim().toLowerCase();
  const lengthGuideline = LENGTH_GUIDELINES[length] || LENGTH_GUIDELINES.standard;
  systemPrompt += `\nOutput length: ${lengthGuideline}\n`;

  const targetGuideline = TARGET_MODEL_GUIDELINES[targetModel];
  if (targetGuideline) systemPrompt += `\n${targetGuideline}\n`;

  systemPrompt +=
    "\nYou MUST structure your entire response as exactly these two blocks, in this order,\n" +
    "with no text before, between, or after them:\n\n" +
    "<optimized_prompt>\n" +
    "The full, rewritten prompt in markdown format.\n" +
    "Organized into labeled sections using markdown '##' headers:\n" +
    "## Role\n" +
    "## Context\n" +
    "## Task\n" +
    "## Constraints\n" +
    "## Output Format\n" +
    "</optimized_prompt>\n" +
    "<explanation>\n" +
    "A short markdown bullet-point list of the specific improvements you made and why.\n" +
    "Each bullet point MUST start with the bold section name it applies to (e.g. '**Role**: ...' or '**General**: ...').\n" +
    "</explanation>";

  return { systemPrompt, userText: `Raw Prompt to Optimize:\n${rawPrompt}` };
}

// Vision support: matches Gemini 3.1 Flash-Lite's documented inline-upload
// limits (7 MB, PNG/JPEG/WEBP/HEIC/HEIF) since it's the default hosted model;
// other chat-mode providers with vision-capable models accept the same
// OpenAI-style image_url content part.
const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

export function validateImage(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!match) throw new ValidationError("Image must be a base64 data URL.");
  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new ValidationError(`Unsupported image type "${mimeType}". Supported: PNG, JPEG, WEBP, HEIC, HEIF.`);
  }
  const approxBytes = Math.ceil((match[2].length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new ValidationError("Image is too large (max 7 MB).");
  }
}

// Wraps userText into an OpenAI-style multimodal content array when an image
// is attached; chat-mode providers accept content as either a plain string
// or an array of {type, ...} parts, so this stays a drop-in replacement.
export function buildUserContent(userText, image) {
  if (!image) return userText;
  return [
    { type: "text", text: userText },
    { type: "image_url", image_url: { url: image } },
  ];
}

export function buildOptimizePrompt(body, rawPrompt) {
  const previousPrompt = String(body.previous_prompt || "").trim();
  const refinementInstruction = String(body.refinement_instruction || "").trim();
  if (refinementInstruction.length > 2000) {
    throw new ValidationError("Refinement instruction too long (max 2,000 characters)");
  }
  const isRefinement = Boolean(previousPrompt && refinementInstruction);

  if (isRefinement) {
    return buildRefinementPrompt(body);
  }

  const mode = String(body.mode || "").trim().toLowerCase();
  if (mode === "critique") {
    return buildCritiquePrompt(rawPrompt);
  }

  return buildStandardPrompt(body, rawPrompt);
}

export function buildRefinePassPrompt(rawPrompt, firstOptimized) {
  const systemPrompt =
    "You are an expert prompt engineer. Critique the following optimized prompt through two lenses:\n" +
    "1. Robustness and failure modes (hallucination outs, ambiguity, conflicting rules)\n" +
    "2. Signal density and structure (placement, output contract)\n\n" +
    "Then, output the improved final version in the same two-block format.\n\n" +
    "You MUST structure your entire response as exactly these two blocks, in this order,\n" +
    "with no text before, between, or after them:\n\n" +
    "<optimized_prompt>\n" +
    "The improved final prompt in markdown format.\n" +
    "</optimized_prompt>\n" +
    "<explanation>\n" +
    "A short markdown bullet-point list of what you improved from the first version and why.\n" +
    "</explanation>";

  const userText =
    `Original raw prompt:\n${rawPrompt}\n\n` +
    `First-pass optimized prompt:\n${firstOptimized}`;

  return { systemPrompt, userText };
}

function extractTag(text, tagName, fallbackTags) {
  // Look for exact match with closing tag
  const closingRegex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = text.match(closingRegex);
  if (match) return match[1].trim();
  
  // Fallback: look for opening tag, and stop at any of the fallback tags or end of string
  const fallbacks = fallbackTags.map(t => `<${t}>`).join('|');
  const fallbackRegex = new RegExp(`<${tagName}>([\\s\\S]*?)(?:${fallbacks}|$)`, 'i');
  const fallbackMatch = text.match(fallbackRegex);
  if (fallbackMatch) return fallbackMatch[1].trim();
  
  return "";
}

export function parseDelimitedResponse(rawResponse) {
  let cleanResponse = rawResponse.trim();

  // Strip reasoning blocks case-insensitively
  cleanResponse = cleanResponse
    .replace(/<(think|thinking|thought|reasoning)>[\s\S]*?<\/\1>/gi, "")
    .trim();

  let optimizedText = extractTag(cleanResponse, "optimized_prompt", ["explanation"]);
  let explanationText = extractTag(cleanResponse, "explanation", ["optimized_prompt"]);

  if (!optimizedText) {
    let jsonCandidate = cleanResponse;
    if (jsonCandidate.startsWith("```json")) {
      jsonCandidate = jsonCandidate.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (jsonCandidate.startsWith("```")) {
      jsonCandidate = jsonCandidate.replace(/^```/, "").replace(/```$/, "").trim();
    }
    const firstBrace = jsonCandidate.indexOf("{");
    const lastBrace = jsonCandidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonCandidate = jsonCandidate.slice(firstBrace, lastBrace + 1);
    }
    try {
      const result = JSON.parse(jsonCandidate);
      optimizedText = String(result.optimized_prompt || "").trim();
      explanationText = String(result.explanation || "").trim();
    } catch (e) {
      // fall through to last-resort below
    }

    if (!optimizedText) optimizedText = cleanResponse;
  }

  return { optimizedText, explanationText };
}

const CIRCUIT_CACHE_KEY = "https://prompt-optimizer.local/circuit-breaker-state";
const localMemoryCache = new Map();

// Short, non-reversible-in-practice tag distinguishing which pooled key an
// attempt used, so the circuit breaker mutes only that key, not the whole
// (provider, model) pair when other keys in the pool are still healthy.
function keyFingerprint(key) {
  return key ? key.slice(-6) : "nokey";
}

async function getCircuitStatus(provider, model, keyTag) {
  const cacheKey = `${provider}:${model}:${keyTag}`;

  if (localMemoryCache.has(cacheKey)) {
    const expires = localMemoryCache.get(cacheKey);
    if (Date.now() < expires) return true;
    localMemoryCache.delete(cacheKey);
  }

  try {
    if (typeof caches !== "undefined" && caches.default) {
      const cache = caches.default;
      const response = await cache.match(new Request(CIRCUIT_CACHE_KEY));
      if (response) {
        const data = await response.json();
        if (data[cacheKey] && Date.now() < data[cacheKey]) {
          return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

async function muteModelInCircuit(provider, model, durationSeconds, keyTag) {
  const cacheKey = `${provider}:${model}:${keyTag}`;
  const expiresAt = Date.now() + (durationSeconds * 1000);
  
  localMemoryCache.set(cacheKey, expiresAt);

  try {
    if (typeof caches !== "undefined" && caches.default) {
      const cache = caches.default;
      let state = {};
      const req = new Request(CIRCUIT_CACHE_KEY);
      const existing = await cache.match(req);
      if (existing) {
        try {
          state = await existing.json();
        } catch (err) {}
      }
      state[cacheKey] = expiresAt;

      const response = new Response(JSON.stringify(state), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `max-age=${durationSeconds}`,
        }
      });
      await cache.put(req, response);
    }
  } catch (e) {}
}

async function fetchActiveModelsForProvider(provider, baseUrl, apiKey) {
  const cacheUrl = `https://prompt-optimizer.local/catalog-cache-${provider}`;
  
  try {
    if (typeof caches !== "undefined" && caches.default) {
      const cache = caches.default;
      const cachedResp = await cache.match(new Request(cacheUrl));
      if (cachedResp) {
        return await cachedResp.json();
      }
    }
  } catch (e) {}

  try {
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    const headers = {
      "Content-Type": "application/json",
      ...(provider === "anthropic" 
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { "Authorization": `Bearer ${apiKey}` })
    };
    
    const controller = new AbortController();
    const tId = setTimeout(() => controller.abort(), 5000);
    
    const resp = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(tId);
    
    if (resp.ok) {
      const result = await resp.json();
      if (result) {
        const modelsList = Array.isArray(result.data) ? result.data : result;
        const activeSlugs = modelsList.map(m => String(m.id || m.model || "").trim()).filter(Boolean);

        if (activeSlugs.length > 0) {
          try {
            if (typeof caches !== "undefined" && caches.default) {
              const cache = caches.default;
              await cache.put(new Request(cacheUrl), new Response(JSON.stringify(activeSlugs), {
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control": "max-age=43200",
                }
              }));
            }
          } catch (e) {}
          return activeSlugs;
        }
      }
    }
  } catch (e) {
    console.error(`Failed to fetch official model catalog for ${provider}:`, e);
  }
  return null;
}

function resolveKey(provider, env) {
  const cleanProviderName = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const rawKey = env[`${cleanProviderName}_API_KEY`] || 
                 env[`${cleanProviderName}_KEY`] ||
                 (provider === "nvidia" ? env.NVIDIA_API_KEY :
                  provider === "openrouter" ? env.OPENROUTER_API_KEY :
                  provider === "google" ? env.GOOGLE_API_KEY : undefined);

  if (!rawKey) return null;

  // Split by comma in case of key pooling (e.g. key1,key2,key3)
  const keys = rawKey.split(",").map(k => k.trim()).filter(Boolean);
  if (keys.length === 0) return null;

  // Pick a random key from the pool
  const randomIndex = Math.floor(Math.random() * keys.length);
  return keys[randomIndex];
}

// Hosts a custom base_url must never resolve to: loopback, link-local
// (including the cloud metadata address), and RFC1918 private ranges. This
// blocks the obvious SSRF/open-relay vectors while still allowing any public
// OpenAI-compatible API endpoint a user wants to point their own key at.
function assertSafeBaseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    throw new ValidationError("Base URL must be a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ValidationError("Base URL must use http or https.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "metadata.google.internal") {
    throw new ValidationError("Base URL may not point at a local or metadata address.");
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const isPrivate =
      a === 127 || // loopback
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) || // 169.254.0.0/16 (includes cloud metadata)
      a === 0;
    if (isPrivate) {
      throw new ValidationError("Base URL may not point at a private or link-local address.");
    }
  } else if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd")) {
    throw new ValidationError("Base URL may not point at a private or link-local address.");
  }
}

// Resolves which provider config to use: the caller's own key (BYO, from the
// request body) takes priority; otherwise fall back to a shared key from
// environment secrets (only present on the maintainer's hosted instance).
export async function resolveProviderConfig(body, env) {
  const bodyApiKey = String(body.api_key || "").trim();
  const bodyProvider = String(body.provider || "").trim().toLowerCase();
  const bodyModel = String(body.model || "").trim();
  const bodyBaseUrl = String(body.base_url || "").trim();

  // Set 26-second execution deadline for Cloudflare Pages (30-second max limit)
  const deadline = Date.now() + 26000;

  if (bodyApiKey) {
    const preset = PROVIDER_PRESETS[bodyProvider];
    const mode = preset ? preset.mode : "chat";
    const baseUrl = bodyBaseUrl || (preset ? preset.baseUrl : "");
    const model = bodyModel || (preset ? preset.defaultModel : "");
    if (!baseUrl) throw new ValidationError("A base URL is required for a custom provider.");
    if (!model) throw new ValidationError("A model is required.");
    assertSafeBaseUrl(baseUrl);
    return { attempts: [{ mode, baseUrl, apiKey: bodyApiKey, model, provider: bodyProvider || "custom" }], source: "byo", deadline };
  }

  // No client key supplied — try the server's shared hosted-instance key(s).
  let sharedProviders = String(env.HOSTED_PROVIDER || "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);

  if (bodyProvider && bodyProvider !== "custom") {
    if (sharedProviders.includes(bodyProvider)) {
      sharedProviders = [bodyProvider];
    } else {
      throw new ValidationError(`API key is required for provider "${bodyProvider}".`);
    }
  }

  // Pre-load catalogs in parallel to avoid sequential delay bottlenecks (skip 'google' since model names are static and API parameters differ)
  const catalogPromises = sharedProviders.map(async (provider) => {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset || !preset.baseUrl || provider === "google") return null;
    
    const key = resolveKey(provider, env);
    if (key) {
      const activeList = await fetchActiveModelsForProvider(provider, preset.baseUrl, key);
      return { provider, activeList };
    }
    return null;
  });

  const resolvedCatalogs = await Promise.all(catalogPromises);
  const catalogs = {};
  for (const item of resolvedCatalogs) {
    if (item && item.activeList) {
      catalogs[item.provider] = item.activeList;
    }
  }

  const attempts = [];
  sharedProviders.forEach((provider, i) => {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) return;

    const cleanProviderName = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    // Bail out early if the provider has no key configured at all, but
    // otherwise resolve a (possibly pooled) key per model below, so a
    // rate-limited/bad key on one model attempt doesn't force every other
    // fallback model for this provider to reuse the same unlucky pick.
    if (!resolveKey(provider, env)) return;

    const rawModels = env[`HOSTED_MODEL_${cleanProviderName}`] || (i === 0 ? env.HOSTED_MODEL : "");
    const models = String(rawModels || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    if (!models.length && preset.defaultModel) models.push(preset.defaultModel);

    for (const model of models) {
      // If the client requested a specific model for this hosted provider, skip other models
      if (bodyModel && bodyModel !== model) {
        continue;
      }
      // If the official catalog was fetched successfully and this model is not in it, skip it
      if (catalogs[provider] && !catalogs[provider].includes(model)) {
        continue;
      }
      const key = resolveKey(provider, env);
      attempts.push({ mode: preset.mode, baseUrl: preset.baseUrl, apiKey: key, model, provider });
    }
  });

  // Filter out any attempts that are currently muted in the circuit breaker
  let activeAttempts = [];
  for (const attempt of attempts) {
    if (!(await getCircuitStatus(attempt.provider, attempt.model, keyFingerprint(attempt.apiKey)))) {
      activeAttempts.push(attempt);
    }
  }

  // Last resort fallback: if all attempts were filtered out by the circuit breaker, try all of them anyway
  if (activeAttempts.length === 0) {
    activeAttempts = attempts;
  }

  if (activeAttempts.length) return { attempts: activeAttempts, source: "hosted", deadline };

  throw new ValidationError(
    "No API key configured. Add your own key in Settings, or ask the site owner to configure a shared key."
  );
}

// Request preparation factory helper (DRY)
function prepareRequest(attempt, systemPrompt, userText, maxTokens, stream = false) {
  if (attempt.mode === "anthropic") {
    return {
      url: `${attempt.baseUrl.replace(/\/$/, "")}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": attempt.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: attempt.model,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: "user", content: userText }],
        max_tokens: maxTokens,
        ...(stream ? { stream: true } : {}),
      },
    };
  } else {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: userText });

    return {
      url: `${attempt.baseUrl.replace(/\/$/, "")}/chat/completions`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${attempt.apiKey}`,
      },
      body: {
        model: attempt.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      },
    };
  }
}

// Executes connection and retries config.attempts in order, providing robust connection timeouts
async function executeWithFallback(config, systemPrompt, userText, maxTokens, stream, signal, handler) {
  let lastError;
  const deadline = config.deadline || (Date.now() + 26000);

  for (const attempt of config.attempts) {
    const now = Date.now();
    if (now >= deadline - 1000) {
      lastError = new Error("Execution budget exceeded (request timed out)");
      break;
    }

    const controller = new AbortController();
    let abortHandler;
    if (signal) {
      if (signal.aborted) throw new Error("Request aborted");
      abortHandler = () => controller.abort();
      signal.addEventListener("abort", abortHandler);
    }
    
    // Connection timeout of 15 seconds, or remaining budget, whichever is smaller.
    const remainingTime = deadline - now;
    const currentTimeout = Math.min(15000, remainingTime);

    let timeoutId = setTimeout(() => controller.abort(), currentTimeout);
    const resetTimeout = () => {
      clearTimeout(timeoutId);
      const newRemaining = deadline - Date.now();
      if (newRemaining <= 0) {
        controller.abort();
      } else {
        timeoutId = setTimeout(() => controller.abort(), newRemaining);
      }
    };

    try {
      const { url, headers, body } = prepareRequest(attempt, systemPrompt, userText, maxTokens, stream);
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error(`Upstream provider error (${attempt.provider}/${attempt.model}, ${resp.status}): ${text.slice(0, 300)}`);
        // Only echo the upstream body back when the caller supplied their own
        // key (config.source === "byo") — it's their own account's error to
        // see. For the shared hosted key, the raw body can contain the site
        // owner's account/org details, so keep the client-facing message generic.
        const detail = config.source === "byo" ? `: ${text.slice(0, 300)}` : "";
        throw new Error(`Upstream provider error (${resp.status})${detail}`);
      }

      const result = await handler(resp, attempt, resetTimeout, controller.signal);
      return result;
    } catch (e) {
      lastError = e;
      if (signal?.aborted) break;

      // Trigger Circuit Breaker Mute
      try {
        const isTimeout = e.name === "AbortError" || /timeout|abort/i.test(e.message || "");
        const isRateLimit = /error \(429\)/i.test(e.message || "");
        const isAuthError = /error \(401\)|error \(403\)/i.test(e.message || "");
        const isServiceUnavailable = /error \(503\)|error \(500\)/i.test(e.message || "");

        const keyTag = keyFingerprint(attempt.apiKey);
        if (isAuthError) {
          // Mute for 24 hours if key is unauthorized
          await muteModelInCircuit(attempt.provider, attempt.model, 86400, keyTag);
        } else if (isRateLimit) {
          // Mute for 1 hour if rate limited
          await muteModelInCircuit(attempt.provider, attempt.model, 3600, keyTag);
        } else if (isTimeout || isServiceUnavailable) {
          // Mute for 10 minutes if timed out or service is down
          await muteModelInCircuit(attempt.provider, attempt.model, 600, keyTag);
        }
      } catch (muteErr) {
        // Fail silently so circuit breaker error doesn't hide the original API error
      }
    } finally {
      clearTimeout(timeoutId);
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  throw lastError;
}

export async function callCompletion(config, systemPrompt, userText, maxTokens = 4000, signal = null) {
  return executeWithFallback(config, systemPrompt, userText, maxTokens, false, signal, async (resp, attempt) => {
    const data = await resp.json();
    let content = "";
    let truncated = false;
    let usage = data.usage || null;

    if (attempt.mode === "anthropic") {
      content = (data.content || []).map((b) => b.text || "").join("").trim();
      truncated = data.stop_reason === "max_tokens";
      if (data.usage) {
        usage = {
          prompt_tokens: data.usage.input_tokens || 0,
          completion_tokens: data.usage.output_tokens || 0
        };
      }
    } else {
      const choice = (data.choices || [])[0] || {};
      content = String(choice.message?.content || "").trim();
      truncated = String(choice.finish_reason || "") === "length";
    }

    return { content, truncated, model: attempt.model, usage };
  });
}

export async function streamCompletion(config, systemPrompt, userText, maxTokens = 4000, onChunk, signal = null) {
  return executeWithFallback(config, systemPrompt, userText, maxTokens, true, signal, async (resp, attempt, resetTimeout, executionSignal) => {
    if (!resp.body) throw new Error("Response body is null");
    let truncated = false;
    let usage = null;

    for await (const event of iterSseEvents(resp.body, executionSignal)) {
      resetTimeout();
      if (event.data === "[DONE]") break;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        continue;
      }

      if (data.usage) {
        usage = data.usage;
      }

      if (attempt.mode === "anthropic") {
        if (data.type === "message_start" && data.message?.usage) {
          usage = {
            prompt_tokens: data.message.usage.input_tokens || 0,
            completion_tokens: data.message.usage.output_tokens || 0
          };
        }
        if (data.type === "message_delta" && data.usage) {
          if (!usage) usage = { prompt_tokens: 0, completion_tokens: 0 };
          usage.completion_tokens = data.usage.output_tokens || 0;
        }
        if (data.type === "content_block_delta" && data.delta?.text) {
          onChunk(data.delta.text);
        }
        if (data.type === "message_delta" && data.delta?.stop_reason === "max_tokens") {
          truncated = true;
        }
      } else {
        const choice = (data.choices || [])[0];
        const piece = choice?.delta?.content;
        if (piece) onChunk(piece);
        if (String(choice?.finish_reason || "") === "length") {
          truncated = true;
        }
      }
    }

    return { truncated, model: attempt.model, usage };
  });
}

// Minimal SSE parser: yields {data} per message block. Handles \n\n and \r\n\r\n.
export async function* iterSseEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) throw new Error("Request aborted");
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let offset = 0;
      while (true) {
        const idx = buf.indexOf("\n\n", offset);
        let delimiterLen = 2;
        const crlfIdx = buf.indexOf("\r\n\r\n", offset);
        let chosenIdx = idx;
        if (crlfIdx !== -1 && (idx === -1 || crlfIdx < idx)) {
          chosenIdx = crlfIdx;
          delimiterLen = 4;
        }
        if (chosenIdx === -1) break;

        const raw = buf.slice(offset, chosenIdx);
        offset = chosenIdx + delimiterLen;

        const dataLines = raw.split(/\r?\n/).filter((l) => l.startsWith("data:"));
        if (!dataLines.length) continue;
        const data = dataLines.map((l) => l.slice(5).trim()).join("\n");
        yield { data };
      }
      if (offset > 0) {
        buf = buf.slice(offset);
      }
    }
    buf += decoder.decode();
    
    // Yield any remaining unparsed events from the stream termination flush
    const remaining = buf.trim();
    if (remaining.length > 0) {
      const dataLines = remaining.split(/\r?\n/).filter((l) => l.startsWith("data:"));
      if (dataLines.length) {
        yield { data: dataLines.map((l) => l.slice(5).trim()).join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

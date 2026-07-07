# Promptimizer

Live website: [https://promptimizer.optiqo.dev/](https://promptimizer.optiqo.dev/) · [📋 Public Roadmap](https://github.com/users/OptiLabResearch/projects/1/views/1)

Paste a rough prompt, get back a structured, model-tailored rewrite — with chain-of-thought, few-shot, and XML technique toggles, per-target-model guidance (Claude, GPT, Gemini, or local), iterative refinement, a word-diff view, and a before/after test run against the raw vs. optimized prompt.

Runs entirely on Cloudflare Pages + Pages Functions. No database, no build step — a static HTML page plus a few small API functions that call whatever OpenAI-compatible, Anthropic-compatible, or Google-compatible endpoint you configure.

---

## 🔍 How It Works

Promptimizer takes a user's rough prompt and applies advanced prompt engineering principles to rewrite it into a highly structured, model-tailored version. Under the hood, it performs the following steps:

1. **Meta-Prompting:** Uses optimized system instructions to guide an LLM to critique and restructure your prompt.
2. **Technique Toggles:** Users can toggle advanced prompting techniques such as:
   - **Chain of Thought (CoT):** Guides the model to reason step-by-step before outputting the final response.
   - **Few-Shot Examples:** Inserts dynamic/static placeholder examples to teach the model style/format.
   - **XML Formatting:** Structures inputs and outputs with XML tags for optimal readability by modern LLMs.
3. **Model-Specific Guidance:** Tailors the optimized prompt structure depending on the target model selected (e.g., Claude, GPT, Gemini, or Local).
4. **Iterative Refinement:** Allows users to refine prompts iteratively, analyzing the differences in a clean word-diff view.
5. **Comparison Test Bench:** Runs a before/after comparison test against both the raw prompt and the optimized prompt in parallel using live completion APIs.

---

## 🛠️ Getting Started & Hosting Locally

### Prerequisites
- **Node.js** (v18 or higher recommended)
- A Cloudflare account (if deploying to Cloudflare Pages)

### Local Setup
1. **Clone this repository:**
   ```bash
   git clone https://github.com/OptiLabResearch/promptimizer.git
   cd promptimizer
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Configure Environment Variables:**
   Copy the example environment variable file to `.dev.vars` and add any provider API keys you wish to use during development:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   *Note: `.dev.vars` is ignored by Git and will never be committed.*

4. **Start the local development server:**
   ```bash
   npm run dev
   ```
   This will start `wrangler pages dev`, serving the frontend and API routes on [http://localhost:8788](http://localhost:8788).

### Bring Your Own API Key (Default)
By default, anyone using your hosted instance can click the settings gear in the top-right corner to configure their own LLM provider (Groq, Google, OpenRouter, NVIDIA NIM, OpenAI, Anthropic, or any custom OpenAI-compatible endpoint) and API key. These keys are stored only in the user's browser (`localStorage`) and sent directly to the serverless function per request — they are never logged or stored server-side.

---

## 🌐 Deploying to Cloudflare Pages

You can deploy the project to Cloudflare Pages in one of two ways:

1. **GitHub Git-Integration (Recommended):** Connect this repository directly in the Cloudflare Pages dashboard for automatic deployment on every git push.
2. **Manual CLI Deployment:**
   ```bash
   npm run deploy
   ```

---

## ⚙️ Optional: Hosting a Shared Free-Tier Key

If you want visitors to be able to use the tool without entering their own key, you can configure shared API keys as environment variables/secrets on the Pages project in the Cloudflare Dashboard (Settings → Environment Variables / Secrets):

* **`HOSTED_PROVIDER`**: Comma-separated list of providers, tried in order (e.g., `groq,google,nvidia,openrouter`). If every model on one provider errors out (e.g., rate-limited), the next provider in the list is automatically tried as a fallback.
* **`HOSTED_MODEL_<PROVIDER>`**: Comma-separated list of model IDs scoped to that specific provider (e.g. `HOSTED_MODEL_GROQ="openai/gpt-oss-120b"`).
* **Secrets (`GROQ_API_KEY`, `GOOGLE_API_KEY`, `NVIDIA_API_KEY`, `OPENROUTER_API_KEY`)**: Configure these as encrypted **secrets** in the Cloudflare Pages settings. Never expose keys in plain environment variables or commit them to the repository.

---

## 📂 Project Layout

```
public/index.html                           The single-page frontend application (vanilla HTML/CSS/JS)
functions/api/optimize-prompt.js            POST — one-shot optimize/refine/critique endpoint
functions/api/optimize-prompt/stream.js     POST — SSE streamed optimize endpoint
functions/api/optimize-prompt/test.js       POST — test run comparison endpoint
functions/_lib/optimizer.js                 Shared prompt-building & LLM provider execution logic
```

---

## 🤝 Contributing

We welcome contributions to Promptimizer! Here are some ways you can help:
- **Optimize Templates:** Improve the prompt optimization templates located in `functions/_lib/optimizer.js`.
- **Add Model Guidelines:** Update target model-specific rules to match the latest best practices.
- **UI/UX Enhancements:** Suggest and implement improvements to the frontend user interface in `public/index.html`.
- **Bug Fixes:** Submit pull requests for issues found in either the frontend or backend Pages Functions.

### Run Tests
Ensure all unit tests pass before submitting a PR:
```bash
npm test
```

# App Manual: Controls & Features

This guide explains how to use each control in the Promptimizer interface to fine-tune your results.

## Configuration Controls

- **Target Model:** Select the specific LLM architecture you plan to use the optimized prompt on (Generic, Claude, GPT, Gemini, or Small Local).
  - *Claude:* Delimits data with XML tags (e.g. `<context>`) and structures prompts for Anthropic's long-context attention window.
  - *GPT:* Favors clean markdown headers and bulleted lists.
  - *Gemini:* Uses structured markdown sections designed for Google's reasoning engines.
  - *Small Local:* Rewrites prompts to be simpler and more direct, avoiding complex nesting that small models fail to follow.
- **Length:** Choose from **Concise** (keep it short and tight), **Standard** (moderate expansion), or **Full** (exhaustive context, rules, and safety nets).
- **Strength:** Adjusts the structural rewrite behavior.
  - *Concise:* Focuses solely on eliminating fluff and organizing core instructions.
  - *Balanced:* Standard balance of structural formatting and instruction expansion.
  - *Detailed:* Heavily annotates constraints, edge cases, and safety instructions.
- **Techniques:**
  - *Chain of Thought (CoT):* Instructs the model to output step-by-step reasoning. Auto-disabled for reasoning-native models (which use thinking API budgets).
  - *Few-shot:* Includes empty placeholders for positive and negative examples to guide the model.
  - *XML Tags:* Explicitly structures sections with XML tags.
  - *Placeholders:* Converts variables in the raw prompt to `{{variable}}` syntax.

## Workflow Actions

- **Optimize:** Sends your prompt to the selected Engine to restructure, rewrite, and format.
- **Critique:** Performs an audit of your raw prompt across four criteria (Outcome Clarity, Structure, Output Contract, Robustness) and scores each 1-10, with the top 3 recommended fixes.
- **Refine:** Modify your optimized prompt iteratively by giving natural language instructions (e.g. "Add a constraints section for security" or "Make the tone friendlier").
- **Test Bench:** Opens a split-screen view. You can enter test variables, run both the original and optimized prompts side-by-side, and view a verdict comparing their outputs.

## Management & Sharing

- **Library & History:** Saved prompts are persisted in your browser's localStorage. You can rename prompts, add tags, track version history (v1, v2, v3), or access recent runs.
- **Export:** Save your prompt to your local machine as Markdown (.md) with frontmatter, Plain Text (.txt), or structured JSON (containing the variable schema).
- **Variables Sandbox:** If your prompt contains placeholders like `{{name}}` or `[UPPERCASE]`, the UI displays form fields where you can enter test values and preview the compiled prompt in real-time.

## Keyboard Shortcuts & Drag-and-Drop

- **Keyboard Shortcuts:**
  - Press `Ctrl+Enter` (or `Cmd+Enter` on macOS) to quickly trigger the primary action (Optimize when focused on the main input, or Run comparison when inside the Test Bench).
  - Press `Escape` to close any open panels, settings, guide, or modals.
- **File Drag-and-Drop:** Drag and drop a plain text file (with a `.txt` or `.md` extension) directly onto the raw prompt textarea to instantly load its contents.

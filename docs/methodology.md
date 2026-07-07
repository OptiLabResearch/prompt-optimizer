# Methodology: How to Prompt-Optimize

Promptimizer applies a strict set of 2026-era prompt-engineering rules to rewrite prompts. These guidelines are compiled directly from research by Anthropic, OpenAI, and Google.

## Core Optimization Principles

1. **Outcome-First Architecture**
   Define what "done" looks like rather than micromanaging every step. Specify the expected outcome, success criteria, hard constraints, and output shape. Avoid prescribing procedures unless a compliance framework or fixed pipeline strictly requires it.

2. **Structured Anatomy**
   Organize the prompt into clearly labeled sections using markdown `##` headers:
   - `## Role`: Define the persona and baseline capabilities.
   - `## Context`: Set the background information and domain.
   - `## Task`: Detail the primary objective.
   - `## Constraints`: Establish hard boundaries and rules.
   - `## Output Format`: Dictate the exact response structure.

3. **Data/Instruction Separation**
   Delineate input data and reference documents clearly from instructions using XML tags (e.g., `<document>`, `<example>`) or markdown blockquotes. Keep reference materials at the top, and put query and instructions at the bottom.

4. **Output Contracts**
   Instead of soft requests like "be concise" or "output JSON", write strict format specifications. Provide explicit schemas, templates, or hard limits (e.g., "Output ≤ 3 bullet points").

5. **Decision Rules Over Absolutes**
   Reserve words like "ALWAYS" and "NEVER" for absolute system invariants. For typical judgment calls, use conditional logic (e.g., "If X is present, perform Y; otherwise, skip to Z").

6. **High Signal, Low Noise**
   Eliminate conversational boilerplate, polite filler, and generic statements (e.g., "Please act as a world-class expert"). Every token in the prompt must serve a functional purpose.

7. **Negative Constraints & Outs**
   Provide anti-hallucination exits like "If you are unsure or the data is missing, output 'N/A' — never make up details".

---
title: Evaluating LLMs as Translators
slug: mt-evaluation
kind: project
summary: Korean→English machine-translation study benchmarking 15 systems (commercial MT, frontier LLMs, and local open-weight models) with COMET, BLEU, chrF2, and TER against a published human translation.
period: Fall 2025
role: Graduate coursework (PHIL 8400, University of Georgia)
stack: [memoQ, MATEO, COMET, BLEU, chrF2, TER, Ollama]
links:
  - { label: "Code & results", url: "https://github.com/William0Holden/llm-translation-eval" }
media: []
featured: false
order: 7
theme: { accent: "#5eead4", accent2: "#f0abfc", bg: "#08110f", mood: "bilingual, ink and paper" }
---

- Ran a professional Korean→English translation workflow in memoQ (translation memories,
  glossary, QA checks).
- Benchmarked 15 systems with the MATEO toolkit: DeepL, Google, ModernMT, GPT-5, Claude, DeepSeek,
  and local open-weight models (Llama 3.x 1B/8B/70B, Qwen3 1.7B/8B, Gemma 3 27B, gpt-oss 20B/120B,
  Aya 35B).
- Against the published English translation, DeepL led on COMET (**86.46**), while Claude,
  DeepSeek, and GPT-5 beat it on BLEU and chrF2 (Claude: BLEU 30.29, chrF2 57.35; DeepSeek COMET
  86.10).

---
title: Evaluating LLMs as Translators
slug: mt-evaluation
kind: project
summary: Korean→English machine-translation study benchmarking 15 systems (commercial MT, frontier LLMs, and local open-weight models) with COMET, BLEU, chrF2, and TER.
period: Fall 2025
role: Graduate coursework (PHIL 8400, University of Georgia)
stack: [memoQ, MATEO, COMET, BLEU, chrF2, TER, Ollama]
links: []
media: []
featured: false
order: 7
theme: { accent: "#5eead4", accent2: "#f0abfc", bg: "#08110f", mood: "bilingual, ink and paper" }
---

- Ran a professional Korean→English translation workflow in memoQ (translation memories,
  glossary, QA checks) to build a reference translation.
- Benchmarked 15 systems against it with the MATEO toolkit: DeepL, Google, ModernMT, GPT-5,
  Claude, DeepSeek, and local open-weight models (Llama 3.x 1B/8B/70B, Qwen3 1.7B/8B, Gemma 3 27B,
  gpt-oss 20B/120B, Aya 35B).
- Best system: DeepSeek at **COMET 91.3**, BLEU 58.4, chrF2 76.6, TER 34.4. The four metrics
  agreed closely (r = 0.92–0.98).

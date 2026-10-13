---
title: Quant Research Harness
slug: qts
kind: project
summary: A point-in-time equities research system with walk-forward backtests, NLP sentiment signals scored on a local GPU, and a weekly paper-trading rebalance.
period: Jun – Sep 2026
role: Personal project
stack: [Python, DuckDB, pandas, Alpaca API, Streamlit, Ollama]
links: []
media: []
featured: false
order: 8
theme: { accent: "#4ade80", accent2: "#facc15", bg: "#07100a", mood: "terminal green, ticker tape" }
---

- Point-in-time DuckDB store for the S&P 500 without survivorship bias (4.3M price bars).
- 11 signal providers, including 10-K and news sentiment scored by an LLM on a local GPU.
- Walk-forward backtests with look-ahead leak guards; quarter-Kelly sizing with a kill switch.
- Live weekly rebalance against an Alpaca **paper** account, with a Streamlit dashboard.
- Honest verdict: a solid research harness, not a proven edge.

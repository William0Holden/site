---
title: AI Engineering at Aderant
slug: aderant
kind: professional
summary: Three internal AI applications in seven months, each replacing a manual process for the teams behind Aderant's docketing and legal-content products.
period: Dec 2025 – present
role: AI Engineer, Docketing & VI Engineering · Atlanta, GA (hybrid)
stack: [Python, TypeScript, React, AWS Bedrock, AgentCore, Lambda, ECS/EKS, EC2, Aurora/RDS, S3, Route 53, Claude Platform, Browserbase, Terraform, Flux GitOps, Grafana]
links: []
media: []
featured: true
order: 1
theme: { accent: "#7aa2ff", accent2: "#b48cff", bg: "#0b0f1a", mood: "calm, precise, legal-tech blue" }
---

<!-- CONFIDENTIAL: this page may say only what is below. No architecture details, screenshots,
client names, or numbers beyond these bullets. -->

- Designed and delivered three internal AI applications in seven months, each replacing a manual
  process for the teams that maintain Aderant's docketing and legal-content products.
- **Forms change detection:** a platform monitoring 60,000+ court, agency, and judicial forms in
  the Forms Workflow content library, surfacing revisions as structured, reviewable diffs.
- **Agentic court-rules monitoring:** crawls court websites across U.S. jurisdictions via
  Browserbase remote browsers, filters DOM noise to isolate true-positive changes, and applies
  Claude reasoning via Bedrock to judge whether a change materially affects a rule or deadline.
- **Competitive-intelligence hub:** deduplicates external news alongside Aha! and Marketo data
  into a RAG pipeline over a vector store; teams chat with the corpus and auto-generate
  battlecards, newsletters, and briefs grounded in cited sources.
- **SDLC intake agent:** validates and normalizes inbound bug reports and enhancement requests
  with an LLM, then routes deduplicated tickets into GitHub Projects and Slack.

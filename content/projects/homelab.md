---
title: Homelab
slug: homelab
kind: homelab
summary: Self-hosted media, personal cloud, and local AI on my own hardware, with custom MCP servers that let an AI assistant operate all of it.
period: Dec 2020 – present
stack: [Docker, Jellyfin, Nextcloud, Ollama, LibreChat, MCP, Python, Cloudflare Tunnel]
links: []
media: [first-build-2020]
featured: false
order: 9
theme: { accent: "#22d3ee", accent2: "#818cf8", bg: "#05080d", mood: "server-rack LEDs at night" }
---

It started in December 2020 as an open-bench build on a cardboard box. Today it's a small,
always-on server plus a GPU workstation that wakes up when there's inference to do.

- **Hardware:** a Minisforum NAB6 mini PC (Intel i7-12650H) with a ~48 TB storage pool, and a
  GPU workstation with an RTX 4070 Ti for local models.
- **Media server:** Jellyfin, shared with friends and family, with automated library management
  for movies, TV, subtitles, and music.
- **Personal cloud:** Nextcloud for files, photos, calendars, and contacts.
- **Local AI chat:** a self-hosted LibreChat front end over Ollama models on the GPU box, with
  wake-on-inference, a self-hosted code interpreter, and RAG over my own documents.
- **AI-operable:** custom MCP servers expose the media stack, Nextcloud, and a browser-automation
  service as tools, routed through a meta-tool layer so an assistant can use hundreds of tools
  without drowning in their definitions.
- **Self-healing:** ~30 scheduled watchdogs that detect and repair common failures (VPN drops,
  stuck downloads, storage issues), plus nightly backups.

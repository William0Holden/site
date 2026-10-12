---
title: Homelab
slug: homelab
kind: homelab
summary: Self-hosted media streaming and personal cloud storage on my own hardware, plus custom MCP servers that let an AI assistant manage both.
period: Ongoing
stack: [Jellyfin, Nextcloud, Docker, MCP]
links: []
media: []
featured: false
order: 7
draft: true
theme: { accent: "#22d3ee", accent2: "#818cf8", bg: "#05080d", mood: "server-rack LEDs at night" }
---

<!-- DRAFT for William's approval (draft: true hides it). Written from services visible through
his connectors, not from anything he wrote. NEVER add hostnames, domains, IPs, or login pages. -->

- **Media server:** Jellyfin for streaming, with automated library management for movies, TV,
  subtitles, and music requests.
- **Personal cloud:** Nextcloud for files, photos, calendars, and contacts.
- **AI-operable:** custom MCP servers expose the media stack and Nextcloud as tools, so an AI
  assistant can search the library, request titles, and manage files.

<!-- TODO(william): hardware, OS/hypervisor, containers vs VMs, how it's exposed (tunnel/VPN),
backups, monitoring. Only what you're comfortable being public. -->

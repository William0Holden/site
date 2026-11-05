---
title: DeckTection
slug: decktection
kind: project
summary: Trading-card identification pipeline (YOLOv12 → SAM2 → Siamese network). YOLOv12 fine-tuned to 99.49% mAP50; ResNet-18 Siamese network at 95% one-shot accuracy across 4,000 cards.
period: Spring 2025
role: Computer Vision course project (CSCI 8820), with Alex Darwiche
stack: [PyTorch, YOLOv12, SAM2, ResNet-18, OpenCV]
links:
  - { label: "Code (team repo)", url: "https://github.com/DeckTection/DeckTection" }
media: [decktection-detections, decktection-segmented-crop, decktection-normalized-card, decktection-siamese-classification, decktection-yolo-training, decktection-siamese-results]
featured: true
order: 3
theme: { accent: "#ff6b9a", accent2: "#ffd166", bg: "#140a12", mood: "playful, holographic foil" }
blurb: "Trading-card identification: YOLOv12, then SAM2, then a Siamese network."
headline: "95% one-shot"
stats:
  - { label: "detection mAP50", value: "99.49%", ratio: 0.9949 }
  - { label: "one-shot accuracy", value: "95%", ratio: 0.95 }
  - { label: "cards covered", value: "4,000" }
tour:
  - { tab: find, title: "Find every card", text: "A YOLOv12 detector, fine-tuned to 99.49% mAP50, boxes each card in a cluttered real-world scene.", note: "Every box has its own confidence score.", media: decktection-detections }
  - { tab: cut, title: "Cut one out", text: "SAM2 separates a detected card from the table and everything around it.", note: "The card is still at its original angle here.", media: decktection-segmented-crop }
  - { tab: straighten, title: "Straighten it", text: "The cut-out is warped to a flat, front-facing view so the identifier always sees the same shape.", note: "Same card as the previous step.", media: decktection-normalized-card }
  - { tab: identify, title: "Name it from one example", text: "A ResNet-18 Siamese network ranks catalog cards by embedding distance, reaching 95% one-shot accuracy across 4,000 cards.", note: "Its top guess for the circled card is correct.", media: decktection-siamese-classification }
---

- Engineered an end-to-end CV pipeline: YOLOv12 → SAM2 → Siamese network.
- Fine-tuned YOLOv12 to **99.49% mAP50** for card detection.
- Trained a ResNet-18 Siamese network to **95% one-shot accuracy** across 4,000 cards.

<!-- Images: from the team repo (card_detection/ and card_preprocessing/ in DeckTection/DeckTection). TODO(william): demo clip? Period
"Spring 2025" comes from the CSCI 8820 proposal dates; confirm. -->

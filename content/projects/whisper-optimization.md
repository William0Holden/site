---
title: Whisper Inference Optimization
slug: whisper-optimization
kind: project
summary: INT8 quantization of the Whisper encoder (−70% size, no material word-accuracy loss on LibriSpeech) plus Winograd convolution for 1D layers, 60% compression for mobile deployment.
period: Spring 2025
role: ML Systems course project (CSCI 8000, University of Georgia), team project
stack: [ONNX Runtime, PyTorch, Quantization]
links:
  - { label: "Code (team repo)", url: "https://github.com/alexander-darwiche/CS8000-MLSys" }
media: [whisper-results-table, whisper-size-speed]
featured: false
order: 4
theme: { accent: "#4fd1c5", accent2: "#a3e635", bg: "#06131a", mood: "cool, waveform, signal" }
---

- Quantized the Whisper encoder to INT8, cutting model size **70%** with no material
  word-accuracy loss on LibriSpeech.
- Implemented Winograd convolution for 1D layers: **60% compression**, enabling mobile deployment.

<!-- TODO(william): confirm period (inferred from Apr 2025 benchmark files). Drive has "winograd_benchmark_results" (Sheet + CSV) that could become a chart. -->

---
title: Broiler Behavior Recognition
slug: broiler-behavior
kind: research
summary: A spatiotemporal video encoder with metadata fusion (X3D 3D-CNN + YOLO tracking) for automated broiler-chicken behavior recognition. Published in Computers and Electronics in Agriculture.
period: 2024 – Dec 2025
role: Graduate Research Assistant, Computer Vision · UGA School of Computing
stack: [PyTorch, X3D, YOLOv11-Pose, ByteTrack, OpenCV, Python]
links:
  - { label: "Paper (DOI)", url: "https://doi.org/10.1016/j.compag.2026.112159" }
  - { label: "Code", url: "https://github.com/William0Holden/chicken_action_recognition" }
media: [poster-presentation, broiler-behaviors, pipeline-overview, x3d-metadata-fusion, raw-vs-stabilized, annotated-tracking-frame, confusion-matrix, x3d-training-curves, chicken-trajectories, overall-density-heatmap]
featured: true
order: 2
theme: { accent: "#f5b84a", accent2: "#7fd18b", bg: "#14110a", mood: "warm, organic, farm-at-dawn" }
---

Master's thesis research in the Precision Poultry Lab at the University of Georgia (advisor
Dr. Guoming Li), in collaboration with the University of Ghana: recognizing what individual
broiler chickens are doing from ordinary smartphone video, and turning it into movement and
behavior analytics that compare Ross 308 broilers with African local chickens.

- Built a spatiotemporal video encoder with metadata fusion (X3D 3D-CNN + YOLOv11-Pose detection with ByteTrack tracking) for
  automated broiler-chicken behavior recognition from smartphone farm footage.
- **87.08% test accuracy** (macro F1 0.871) on behavior recognition; drinking F1 0.949, eating
  F1 0.928. Benchmarked against SlowFast, I3D, and TimeSformer.
- Pose model (YOLOv11-Pose) at **0.971 mAP50** / 0.860 mAP50-95.
- Developed motion-correction algorithms to normalize avian kinematics and remove human-handling
  bias, enabling reliable velocity and acceleration metrics from handheld video.
- **1st place**, UGA Artificial Intelligence in Livestock and Poultry Farming Conference poster
  competition (September 2025).

**Publication:** Holden, W.O., Li, G., Agyemang-Duah, E., Poku, R.A., Adenyo, C., Osei-Amponsah, R.,
Aggrey, S.E. "Spatiotemporal video encoder integrated with metadata fusion for action recognition
and behavior analysis." *Computers and Electronics in Agriculture* 253 (2026), 112159 (IF 10.3).

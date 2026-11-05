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
blurb: "Video encoder with metadata fusion for chicken behavior recognition."
headline: "F1 0.871"
stats:
  - { label: "test accuracy", value: "87.08%", ratio: 0.8708 }
  - { label: "macro F1", value: "0.871", ratio: 0.871 }
  - { label: "drinking F1", value: "0.949", ratio: 0.949 }
  - { label: "eating F1", value: "0.928", ratio: 0.928 }
  - { label: "pose mAP50", value: "0.971", ratio: 0.971 }
  - { label: "pose mAP50-95", value: "0.860", ratio: 0.860 }
tour:
  - { tab: clips, title: "What he was looking at", text: "Ordinary smartphone footage from poultry pens. The model has to tell five behaviors apart for each bird: resting, walking, standing, drinking, and eating.", note: "These are real labeled clips from the dataset.", media: broiler-behaviors }
  - { tab: stabilize, title: "Fix the camera in software", text: "Handheld video moves. Motion-correction algorithms normalize avian kinematics and remove human-handling bias, so velocity and acceleration metrics stay reliable.", note: "Compare the blurred raw frame with the sharp stabilized one.", media: raw-vs-stabilized }
  - { tab: track, title: "Find and follow every bird", text: "YOLOv11-Pose detects each chicken and ByteTrack keeps a stable ID on it across frames. The pose model reaches 0.971 mAP50.", note: "Each box carries a track ID, a behavior, and a confidence score.", media: annotated-tracking-frame }
  - { tab: classify, title: "Fuse video with context", text: "A 32-frame clip goes through an X3D-M backbone for 512 visual features. Pose metadata such as velocity and distance to equipment goes through an MLP for 64 more.", note: "The 576 combined dimensions feed a five-class classifier.", media: x3d-metadata-fusion }
  - { tab: evaluate, title: "Check it honestly", text: "87.08% test accuracy with a macro F1 of 0.871, benchmarked against SlowFast, I3D, and TimeSformer.", note: "The largest confusion is standing predicted as walking.", media: confusion-matrix }
  - { tab: analyze, title: "Turn it into analytics", text: "The output is per-bird movement and behavior data, used to compare Ross 308 broilers with African local chickens.", note: "Each line is one bird, followed across a session.", media: chicken-trajectories }
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

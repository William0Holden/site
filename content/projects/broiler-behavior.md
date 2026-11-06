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
  - { label: "Follow-up paper (DOI)", url: "https://doi.org/10.1016/j.jveb.2026.08.002" }
  - { label: "Thesis record", url: "https://openscholar.uga.edu/record/27931" }
media: [poster-presentation, broiler-behaviors, pipeline-overview, x3d-metadata-fusion, raw-vs-stabilized, annotated-tracking-frame, confusion-matrix, x3d-training-curves, chicken-trajectories, overall-density-heatmap]
featured: true
order: 2
theme: { accent: "#f5b84a", accent2: "#7fd18b", bg: "#14110a", mood: "warm, organic, farm-at-dawn" }
blurb: "Video encoder with metadata fusion for chicken behavior recognition."
headline: "F1 0.864"
stats:
  - { label: "test accuracy", value: "86.41%", ratio: 0.8641 }
  - { label: "macro F1", value: "0.864", ratio: 0.864 }
  - { label: "drinking F1", value: "0.949", ratio: 0.949 }
  - { label: "eating F1", value: "0.928", ratio: 0.928 }
  - { label: "pose mAP50", value: "0.971", ratio: 0.971 }
  - { label: "pose mAP50-95", value: "0.860", ratio: 0.860 }
compare:
  title: "Action recognition models: test accuracy"
  rows:
    - { label: "I3D", value: 91.52, unit: "%" }
    - { label: "TimeSformer", value: 86.68, unit: "%" }
    - { label: "X3D + metadata (chosen)", value: 86.41, unit: "%" }
    - { label: "X3D alone", value: 81.70, unit: "%" }
    - { label: "SlowFast", value: 65.14, unit: "%" }
tour:
  - { tab: clips, title: "What he was looking at", text: "Ordinary smartphone footage from poultry pens. The model has to tell five behaviors apart for each bird: resting, walking, standing, drinking, and eating.", note: "These are real labeled clips from the dataset.", media: broiler-behaviors }
  - { tab: stabilize, title: "Fix the camera in software", text: "Handheld video moves. Motion-correction algorithms normalize avian kinematics and remove human-handling bias, so velocity and acceleration metrics stay reliable.", note: "Compare the blurred raw frame with the sharp stabilized one.", media: raw-vs-stabilized }
  - { tab: track, title: "Find and follow every bird", text: "YOLOv11-Pose detects each chicken and ByteTrack keeps a stable ID on it across frames. The pose model reaches 0.971 mAP50.", note: "Each box carries a track ID, a behavior, and a confidence score.", media: annotated-tracking-frame }
  - { tab: classify, title: "Fuse video with context", text: "A 32-frame clip goes through an X3D-M backbone for 512 visual features. Pose metadata such as velocity and distance to equipment goes through an MLP for 64 more.", note: "The 576 combined dimensions feed a five-class classifier.", media: x3d-metadata-fusion }
  - { tab: evaluate, title: "Check it honestly", text: "86.41% test accuracy with a macro F1 of 0.864. I3D scored higher (91.52%) at about seven times the model size, so X3D was the deployment choice.", note: "The largest confusion is standing predicted as walking.", media: confusion-matrix }
  - { tab: analyze, title: "Turn it into analytics", text: "The output is per-bird movement and behavior data. A follow-up paper used this kind of tracking to compare Ross 308 broilers with Ghanaian indigenous chickens under heat load.", note: "Each line is one bird, followed across a session.", media: chicken-trajectories }
---

Master's thesis research in the Precision Poultry Lab at the University of Georgia (advisor
Dr. Guoming Li), in collaboration with the University of Ghana: recognizing what individual
broiler chickens are doing from ordinary smartphone video, and turning it into movement and
behavior analytics that compare Ross 308 broilers with African local chickens.

- Built a spatiotemporal video encoder with metadata fusion (X3D 3D-CNN + YOLOv11-Pose detection with ByteTrack tracking) for
  automated broiler-chicken behavior recognition from smartphone farm footage.
- **86.41% test accuracy** (macro F1 0.864) on behavior recognition; drinking F1 0.949, eating
  F1 0.928.
- Pose model (YOLOv11-Pose) at **0.971 mAP50** / 0.860 mAP50-95.
- Developed motion-correction algorithms to normalize avian kinematics and remove human-handling
  bias, enabling reliable velocity and acceleration metrics from handheld video.
- **1st place**, UGA Artificial Intelligence in Livestock and Poultry Farming Conference poster
  competition (September 2025).

**The data:** 174 handheld smartphone videos (about 3 hours, 1920×1152 at 30 fps) recorded by a technician in
December 2024 at the University of Ghana's Livestock and Poultry Research Centre: two genetic lines and three sessions
a day, from 27.5 °C mornings to 34.8 °C afternoons. The pose models trained on 2,526 annotated instances.

**Why the most accurate model didn't win:** I3D reached 91.52% against 86.41% for X3D with metadata, but X3D is 14.6 MB
with 3.8M parameters and about 943 MB of peak GPU memory, where I3D is 107.2 MB, 28M parameters, and about 1,463 MB.
Small and cheap mattered more for a tool meant to run on modest hardware. SlowFast (65.14%) and TimeSformer (86.68%,
462.6 MB) were the other baselines.

**What metadata fusion added:** velocity and distance to the feeder and drinker lifted X3D from 81.70% to 86.41% with
almost no change in model size. Standing F1 rose from 0.691 to 0.783 and eating from 0.884 to 0.936.

**Other choices he tested:**
- Pose: YOLOv11-Pose (mAP 0.906) over YOLOv8-Pose (0.877), YOLOv12-Pose (0.847), and Faster R-CNN (0.658).
- Stabilization: FFmpeg vid.stab scored best (motion reduction 1.40), but python_video_stab (0.91) kept the pipeline
  in Python without external command-line calls.

**The unglamorous parts:** an interactive tool for labeling clips, focal loss for class imbalance, and a three-frame
"action momentum" rule so a bird's label doesn't flicker between frames. On four test videos ByteTrack produced 133,300
detections across 7,284 frames. Identity fragmentation remained frequent, though tracks stayed long enough for the
32-frame clips the classifier needs.

**Follow-up study:** William is fifth author on a second paper, led by the University of Ghana team, that used
video-based tracking and deep learning on 480 birds to compare Ross 308 broilers with Ghanaian indigenous chickens under
heat load. Indigenous birds stood more (39.2%) and moved more (7.9% against 4.2%), while broilers spent 75.2% of their
time resting. Activity was highest in the morning; resting and drinking rose in the hotter afternoon and evening periods.

**Thesis:** *Artificial Intelligence-Driven Behavioral Recognition and Spatiotemporal Analytics of Broiler Chickens
Using Smartphone-Captured Video Associated with Two Genetic Lines and Three Sessions of a Day* (M.S., University of
Georgia, December 2025, 111 pages). Advisor Guoming Li; committee Suchendra M. Bhandarkar, Wei Niu, and Samuel E. Aggrey.
The full text is embargoed until February 2028. Its public abstract gives 87.08% accuracy; the figures here follow the
peer-reviewed paper.

**Posters:** "Automated Behavior Recognition and Welfare Assessment in Broiler Chickens Using Smartphone and
Spatiotemporal Deep Learning Models," AI in Livestock and Poultry Farming, Athens, GA, September 2025 (first place).
"Spatiotemporal Video Encoder Integrated with Metadata Fusion for Action Recognition and Behavior Analysis in
Smartphone-captured Data," World's Poultry Congress, Toronto, July 2026.

**Publication:** Holden, W.O., Li, G., Agyemang-Duah, E., Poku, R.A., Adenyo, C., Osei-Amponsah, R.,
Aggrey, S.E. "Spatiotemporal video encoder integrated with metadata fusion for action recognition
and behavior analysis." *Computers and Electronics in Agriculture* 253 (2026), 112159 (IF 10.3).

Agyemang-Duah, E., Poku, R.A., Adenyo, C., Osei-Amponsah, R., Holden, W.O., Li, G., Rekaya, R., Aggrey, S.E. "Climate
adaptation in poultry: Spatiotemporal behavioral and kinematic responses of chicken genotypes to identical
temperature-humidity exposures." *Journal of Veterinary Behavior* 87 (2026), 41–49.

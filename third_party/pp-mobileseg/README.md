# `pp-mobileseg-base-ade-512-x2-fp16.tflite`: whose work it is

The model the app finds the sky with is **PP-MobileSeg** (base), by the
PaddleSeg authors at Baidu
([PaddleSeg](https://github.com/PaddlePaddle/PaddleSeg); Tang and others,
"PP-MobileSeg: Explore the Fast and Accurate Semantic Segmentation Model on
Mobile Devices", 2023), trained by them on the
[ADE20K](https://groups.csail.mit.edu/vision/datasets/ADE20K/) dataset
(MIT CSAIL). The weights are the ones
[MMSegmentation](https://github.com/open-mmlab/mmsegmentation/tree/main/projects/pp_mobileseg)
(OpenMMLab) publishes, converted from PaddleSeg's.

PaddleSeg and MMSegmentation are both licensed under the
Apache License, Version 2.0, and the model file here is offered under the
same license: [LICENSE](LICENSE).

**Changed:** converted to LiteRT (`.tflite`), taking images channel-last;
three steps written another way so that it runs on a graphics card, none
changing what it computes; the model's own last step (its scores stretched
to twice as fine a grid) put inside the file, with a step after it that
gives, for each point, how far sky's score is ahead of the buildings',
trees' and ground's together and which class is ahead, in place of a score
for each of 150 classes; and its weights and biases stored 16 bits long.

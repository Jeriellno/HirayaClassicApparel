# models/ — IDM-VTON model weights and preprocessing checkpoints

**Nothing large is committed here.** This directory is gitignored except for
this note and `.gitkeep`. Populate it on the GPU host by following the steps in
`../README.md`.

Expected layout after a full setup:

```
models/
|-- IDM-VTON/                # the model weights (MODEL_PATH)
|   |-- unet/
|   |-- unet_encoder/
|   |-- vae/
|   |-- text_encoder/
|   |-- text_encoder_2/
|   |-- image_encoder/
|   |-- scheduler/
|   |-- tokenizer/
|   |-- tokenizer_2/
|
|-- ckpt/                    # CKPT_DIR — non-IDM-VTON preprocessing checkpoints
    |-- humanparsing/
    |   |-- parsing_atr.onnx
    |   |-- parsing_lip.onnx
    |-- openpose/
    |   |-- ckpts/
    |       |-- body_pose_model.pth
    |-- densepose/
        |-- model_final_162be9.pkl
```

Download links for each of these are in `../README.md`.

> `MODEL_PATH=./models/IDM-VTON` and `CKPT_DIR=./models/ckpt` are the defaults in
> `.env.example`. You may instead leave `MODEL_PATH` as the repo id
> `yisol/IDM-VTON` and let Hugging Face download the weights into its own cache.
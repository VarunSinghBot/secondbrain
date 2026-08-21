import io
import os
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, Query, HTTPException
from pydantic import BaseModel
from PIL import Image
import torch
import numpy as np
from transformers import CLIPProcessor, CLIPModel

app = FastAPI(title="CLIP Microservice", version="1.0.0")

# Defaults picked from real score distributions across a photo and a cartoon/
# screenshot video frame (see clip-sidecar tagging fix): with only 47 short
# candidate prompts, top_k was doing all the real filtering work (threshold
# 0.18 sits below nearly every candidate's score, so it barely excluded
# anything) — capping to the top 5 is what actually removes the long tail of
# unrelated tags. The threshold is nudged up slightly as a floor for images
# with fewer than 5 genuinely relevant concepts, but kept low enough not to
# zero out illustration/screenshot content, which scores lower across the
# board on this base CLIP model than real photos do.
CLIP_TAG_THRESHOLD = float(os.environ.get("CLIP_TAG_THRESHOLD", "0.19"))
CLIP_TAG_TOP_N = int(os.environ.get("CLIP_TAG_TOP_N", "5"))

CLIP_MODEL_ID = "openai/clip-vit-base-patch32"

print(f"Loading CLIP model '{CLIP_MODEL_ID}'...")
clip_model = CLIPModel.from_pretrained(CLIP_MODEL_ID)
clip_processor = CLIPProcessor.from_pretrained(CLIP_MODEL_ID)
clip_model.eval()
print("CLIP model loaded successfully.")

TAG_CANDIDATES = [
    "person", "people", "crowd",
    "animal", "dog", "cat", "bird", "wildlife",
    "nature", "forest", "mountain", "beach", "ocean", "sky", "sunset",
    "city", "street", "building", "architecture", "interior",
    "food", "drink", "meal", "restaurant",
    "vehicle", "car", "airplane", "boat",
    "sport", "outdoor activity", "exercise",
    "technology", "computer", "phone", "screen",
    "art", "painting", "drawing", "abstract",
    "document", "text", "diagram", "chart", "graph",
    "medical", "science", "laboratory",
    "fashion", "clothing", "accessories",
    "event", "celebration", "wedding", "conference",
    "landscape", "rural", "urban", "aerial view",
]

def _extract_tensor(output) -> torch.Tensor:
    if isinstance(output, torch.Tensor):
        return output
    if hasattr(output, "pooler_output") and output.pooler_output is not None:
        return output.pooler_output
    if hasattr(output, "last_hidden_state"):
        return output.last_hidden_state[:, 0, :]
    raise ValueError(f"Cannot extract tensor from output type: {type(output)}")

class TextEmbedRequest(BaseModel):
    text: str

@app.get("/health")
def health():
    return {"status": "ok", "service": "clip-sidecar"}

@app.post("/embed-image")
async def embed_image(file: UploadFile = File(...)):
    try:
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        inputs = clip_processor(images=image, return_tensors="pt")
        with torch.no_grad():
            raw = clip_model.get_image_features(**inputs)
        feats = _extract_tensor(raw)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        vector = feats.squeeze().cpu().numpy().tolist()
        return {"embedding": vector}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image embedding failed: {str(e)}")

@app.post("/embed-text-clip")
async def embed_text_clip(req: TextEmbedRequest):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    try:
        inputs = clip_processor(text=[req.text], return_tensors="pt", padding=True, truncation=True)
        with torch.no_grad():
            raw = clip_model.get_text_features(**inputs)
        feats = _extract_tensor(raw)
        feats = feats / feats.norm(dim=-1, keepdim=True)
        vector = feats.squeeze().cpu().numpy().tolist()
        return {"embedding": vector}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text embedding failed: {str(e)}")

@app.post("/tag-image")
async def tag_image(
    file: UploadFile = File(...),
    threshold: float = Query(CLIP_TAG_THRESHOLD, ge=0.0, le=1.0),
    top_k: int = Query(CLIP_TAG_TOP_N, ge=1, le=40)
):
    try:
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        text_prompts = [f"a photo of {t}" for t in TAG_CANDIDATES]
        text_inputs = clip_processor(text=text_prompts, return_tensors="pt", padding=True, truncation=True)
        img_inputs = clip_processor(images=image, return_tensors="pt")

        with torch.no_grad():
            raw_text = clip_model.get_text_features(**text_inputs)
            raw_img = clip_model.get_image_features(**img_inputs)

        text_feats = _extract_tensor(raw_text)
        img_feats = _extract_tensor(raw_img)

        text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)
        img_feats = img_feats / img_feats.norm(dim=-1, keepdim=True)

        scores = (img_feats @ text_feats.T).squeeze().tolist()
        if isinstance(scores, float):
            scores = [scores]

        ranked = sorted(zip(TAG_CANDIDATES, scores), key=lambda x: x[1], reverse=True)
        tags = [tag for tag, score in ranked[:top_k] if score >= threshold]
        return {"tags": tags, "scores": {tag: round(sc, 4) for tag, sc in ranked[:top_k]}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image tagging failed: {str(e)}")

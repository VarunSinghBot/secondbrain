# prototypes/

Historical reference material only. Nothing here is executed, imported, or maintained as part of the real application — everything in this folder predates and has been superseded by working code elsewhere in the repo.

## `multimodal_rag_verified.ipynb`

The original Colab/Jupyter notebook used to verify the multimodal RAG approach (Groq + Qdrant + Cloudinary + CLIP + Whisper) before `apps/rag-backend`'s real TypeScript pipeline was built. Superseded by `apps/rag-backend/src/` — see `services/indexer.ts`, `lib/embeddings.ts`, `lib/image.ts`, `lib/video.ts`, `lib/llamaparse.ts`, and `lib/groq.ts` for the real, current implementation.

Kept for historical context on the original design, not as a reference implementation — the real code has since diverged (e.g. this notebook still reflects the CLIP zero-shot image-tagging approach that was later replaced by real Groq captioning; see `apps/rag-backend/TEST_REPORT.md` for what's actually true about the system today).

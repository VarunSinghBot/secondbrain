from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Variable names and defaults match apps/rag-backend/src/lib/config.ts."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    groq_api_key: str = ""
    gemini_api_key: str = ""
    ocr_space_api_key: str = ""
    llama_cloud_api_key: str = ""
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""

    qdrant_url: str = ""
    qdrant_api_key: str = ""
    qdrant_collection: str = "rag_text"
    qdrant_image_collection: str = "rag_images"
    qdrant_vector_size: int = 768

    groq_llm_model: str = "openai/gpt-oss-120b"
    groq_asr_model: str = "whisper-large-v3"
    groq_caption_model: str = "qwen/qwen3.6-27b"
    groq_query_rewrite_model: str = "openai/gpt-oss-20b"

    clip_tag_threshold: float = 0.19
    clip_tag_top_n: int = 5

    # Fixed, not env-overridable: stored vectors are tied to this exact model.
    embedding_model: str = "gemini-embedding-001"

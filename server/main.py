import json
import os
import re
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationInfo, field_validator


ALLOWED_TONES = {"warm", "romantic", "funny", "nostalgic", "cinematic", "grateful"}
MAX_TEXT_LENGTH = 900


class MemoryRequest(BaseModel):
    recipient: str = ""
    occasion: str = ""
    message: str = ""
    tone: str = "warm"

    @field_validator("recipient", "occasion", "message", "tone", mode="before")
    @classmethod
    def clean_input(cls, value: Any, info: ValidationInfo) -> str:
        if value is None:
            return ""
        text = re.sub(r"\s+", " ", str(value)).strip()
        limits = {"recipient": 120, "occasion": 160, "message": MAX_TEXT_LENGTH, "tone": 40}
        return text[: limits.get(info.field_name, MAX_TEXT_LENGTH)]

    @field_validator("tone")
    @classmethod
    def normalize_tone(cls, value: str) -> str:
        tone = value.lower().strip()
        return tone if tone in ALLOWED_TONES else "warm"


class MemoryResponse(BaseModel):
    title: str
    polished_message: str
    visual_mood: str
    memory_fragments: list[str]
    suggested_room_index: int
    voiceover_prompt: str

    @field_validator("title", "polished_message", "visual_mood", "voiceover_prompt", mode="before")
    @classmethod
    def clean_output_text(cls, value: Any) -> str:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        return text[:500]

    @field_validator("memory_fragments", mode="before")
    @classmethod
    def clean_fragments(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        fragments = []
        for item in value[:3]:
            text = re.sub(r"\s+", " ", str(item or "")).strip()
            if text:
                fragments.append(text[:180])
        return fragments

    @field_validator("suggested_room_index", mode="before")
    @classmethod
    def clamp_room(cls, value: Any) -> int:
        try:
            index = int(value)
        except (TypeError, ValueError):
            return 0
        return index if index in (0, 1) else 0


app = FastAPI(title="EchoLens Memory Composer API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def title_case(value: str, fallback: str) -> str:
    text = value.strip() or fallback
    return " ".join(word.capitalize() for word in text.split())


def fallback_memory(payload: MemoryRequest) -> MemoryResponse:
    recipient = payload.recipient or "someone special"
    occasion = payload.occasion or "shared memory"
    message = payload.message or "A small moment worth keeping."
    tone = payload.tone if payload.tone in ALLOWED_TONES else "warm"
    suggested_room_index = 1 if tone in {"romantic", "nostalgic", "cinematic"} else 0

    mood_by_tone = {
        "warm": "Soft amber light with a calm, intimate glow",
        "romantic": "Moonlit rose reflections with quiet cinematic depth",
        "funny": "Bright playful color with buoyant postcard energy",
        "nostalgic": "Golden-hour haze with gentle echoes of the past",
        "cinematic": "Wide-screen shadows, luminous edges, and dramatic warmth",
        "grateful": "Clear morning light with tender celebratory accents",
    }

    return MemoryResponse(
        title=f"{title_case(recipient, 'Someone Special')}'s {title_case(tone, 'Warm')} {title_case(occasion, 'Memory')}",
        polished_message=(
            f"{recipient}, {message} EchoLens turns this into a small immersive scene, "
            "holding the feeling close while the postcard comes alive."
        ),
        visual_mood=mood_by_tone.get(tone, mood_by_tone["warm"]),
        memory_fragments=[
            f"The first detail: {occasion}.",
            f"The feeling: {title_case(tone, 'Warm')} and personal.",
            "The keepsake: a postcard memory that opens in AR.",
        ],
        suggested_room_index=suggested_room_index,
        voiceover_prompt=f"Read this in a {tone} tone for {recipient}: {message}",
    )


def chat_completions_url(api_base: str) -> str:
    base = api_base.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def extract_json_object(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("LLM response was not a JSON object")
    return parsed


def build_prompt(payload: MemoryRequest) -> list[dict[str, str]]:
    schema = {
        "title": "string",
        "polished_message": "string",
        "visual_mood": "string",
        "memory_fragments": ["string", "string", "string"],
        "suggested_room_index": 0,
        "voiceover_prompt": "string",
    }

    system_prompt = (
        "You are EchoLens, an AI memory composer for an AR postcard prototype. "
        "Return JSON only. Do not include markdown, explanations, or extra keys. "
        "The JSON must match this schema exactly: "
        f"{json.dumps(schema)}. "
        "Use suggested_room_index 0 for warm, funny, or grateful memories, and 1 for romantic, nostalgic, or cinematic memories. "
        "Keep polished_message under 80 words and provide exactly 3 concise memory_fragments."
    )

    user_prompt = {
        "recipient": payload.recipient,
        "occasion": payload.occasion,
        "message": payload.message,
        "tone": payload.tone,
    }

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(user_prompt)},
    ]


async def call_llm(payload: MemoryRequest) -> MemoryResponse | None:
    api_base = os.getenv("LLM_API_BASE")
    api_key = os.getenv("LLM_API_KEY")
    model = os.getenv("LLM_MODEL")

    if not api_base or not api_key or not model:
        return None

    request_body = {
        "model": model,
        "messages": build_prompt(payload),
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(chat_completions_url(api_base), headers=headers, json=request_body)
        response.raise_for_status()
        data = response.json()

    content = data["choices"][0]["message"]["content"]
    parsed = extract_json_object(content)
    candidate = MemoryResponse.model_validate(parsed)
    fallback = fallback_memory(payload)

    fragments = candidate.memory_fragments[:3]
    while len(fragments) < 3:
        fragments.append(fallback.memory_fragments[len(fragments)])

    return MemoryResponse(
        title=candidate.title or fallback.title,
        polished_message=candidate.polished_message or fallback.polished_message,
        visual_mood=candidate.visual_mood or fallback.visual_mood,
        memory_fragments=fragments,
        suggested_room_index=candidate.suggested_room_index,
        voiceover_prompt=candidate.voiceover_prompt or fallback.voiceover_prompt,
    )


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "echolens-memory-composer"}


@app.post("/api/generate-memory", response_model=MemoryResponse)
async def generate_memory(payload: MemoryRequest) -> MemoryResponse:
    try:
        llm_result = await call_llm(payload)
        if llm_result:
            return llm_result
    except Exception as exc:
        print(f"EchoLens LLM fallback used: {exc}")

    return fallback_memory(payload)

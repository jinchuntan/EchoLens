# EchoLens Memory Composer API

FastAPI backend for the EchoLens hackathon prototype. It exposes one endpoint:

```bash
POST /api/generate-memory
```

The frontend sends recipient, occasion, message, and tone. The server returns structured JSON used by the AR postcard preview and in-camera overlay.

## Run locally

```bash
cd server
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## LLM configuration

Set these environment variables to connect the API to an OpenAI-compatible chat completions endpoint:

```bash
LLM_API_BASE=http://localhost:8001/v1
LLM_API_KEY=replace-with-your-api-key
LLM_MODEL=your-openai-compatible-model
```

`LLM_API_BASE` can point to a hosted or local LLM endpoint. For the AMD Developer Hackathon demo, this backend can be aimed at a model served on AMD Developer Cloud / ROCm infrastructure.

If any LLM variable is missing, the API returns a deterministic mock response so the frontend still works during judging.

## Vercel

The repository root includes `api/index.py`, `requirements.txt`, and `vercel.json` so this FastAPI app can run as a Vercel Python Function at `/api/*`. Configure `LLM_API_BASE`, `LLM_API_KEY`, and `LLM_MODEL` in the Vercel dashboard for real AI mode.

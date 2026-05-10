# EchoLens

EchoLens is an AI-powered immersive postcard generator built for the AMD Developer Hackathon. It keeps the original Zappar + Three.js AR postcard prototype, then adds a memory composer that turns a short message into polished AR-ready content.

The static frontend still runs from `index.html` with no build step. Users generate a memory, preview the AI result, then start the existing AR flow. When the postcard target is detected, the 3D room appears and the generated memory text is shown as an overlay.

## Frontend Usage

Open the site from a static server or GitHub Pages:

```bash
python -m http.server 8080
```

Then visit:

```text
http://localhost:8080
```

By default, the frontend calls:

```js
http://localhost:8000/api/generate-memory
```

When hosted on Vercel, the frontend automatically calls the same origin:

```js
https://your-project.vercel.app/api/generate-memory
```

To point the static frontend at another backend without editing source code:

```js
localStorage.setItem('ECHOLENS_API_BASE', 'https://your-api.example.com')
```

If the backend is offline, EchoLens uses local fallback memory content so the hackathon demo remains functional.

## Backend Setup

```bash
cd server
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The backend exposes:

```text
POST /api/generate-memory
```

Request body:

```json
{
  "recipient": "string",
  "occasion": "string",
  "message": "string",
  "tone": "warm"
}
```

Response body:

```json
{
  "title": "string",
  "polished_message": "string",
  "visual_mood": "string",
  "memory_fragments": ["string", "string", "string"],
  "suggested_room_index": 0,
  "voiceover_prompt": "string"
}
```

## LLM Configuration

Set these variables for an OpenAI-compatible chat completions endpoint:

```bash
LLM_API_BASE=http://localhost:8001/v1
LLM_API_KEY=replace-with-your-api-key
LLM_MODEL=your-openai-compatible-model
```

For the AMD Developer Hackathon, `LLM_API_BASE` can point to a model endpoint hosted on AMD Developer Cloud / ROCm infrastructure. If the variables are missing or parsing fails, the backend returns a deterministic mock response instead of crashing.

## Deploying On Vercel

This repo is Vercel-ready:

- Static frontend files stay at the project root.
- `api/index.py` exposes the FastAPI app to Vercel's Python runtime.
- `vercel.json` explicitly deploys the static frontend and routes `/api/*` requests to that FastAPI function.
- Root `requirements.txt` points Vercel to the backend Python dependencies.

Recommended Vercel project settings:

```text
Project Name: echolens or another lowercase name
Framework Preset: Other
Build Command: None
Output Directory: None
Install Command: None / default
```

The committed `vercel.json` uses explicit Vercel builders, so Vercel deploys the root static files and the Python API function together. If Vercel auto-detects only FastAPI, `/` will return `{"detail":"Not Found"}`; keep `vercel.json` committed to avoid that.

Add these Environment Variables in Vercel Project Settings for real AI mode:

```bash
LLM_API_BASE=https://your-openai-compatible-endpoint/v1
LLM_API_KEY=your-server-side-key
LLM_MODEL=your-model-name
```

Do not prefix these with `NEXT_PUBLIC_` and do not put them in frontend JavaScript. They are only used by the Vercel Python Function.

## What Not To Break

Keep the static frontend and the existing AR path intact:

- Do not remove Zappar, Three.js, GLTFLoader, image tracking, room switching, audio playback, or voice recording.
- Do not hardcode API keys in frontend JavaScript.
- Do not require React, Next.js, Vite, or any frontend build step.
- Do not change `postcard.zpt`, `postcard.jpg`, or the `.glb` room assets unless the AR target or models are intentionally being replaced.

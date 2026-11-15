# Lunar Landing Analyzer V6

Presentation-ready NASA Space Apps prototype.

## Features
- Interactive 3D Moon using NASA LRO-derived lunar color imagery
- Click-to-select lunar latitude/longitude
- NASA PDS Geosciences GDS queries for LOLA and Diviner observations when available
- Derived terrain/slope metrics and hazard checks
- Earth environmental analogue prototype
- Landing simulation with telemetry
- Presentation / Demo Mode
- NASA data/source provenance panel
- Render deployment configuration (`render.yaml`)

## Local run
Windows: double-click `START_WINDOWS.bat`, then open http://localhost:8000

## Deploy
The app is a Python web service. Create a Render Web Service from this folder/repository; Render will use `render.yaml`, or set build command `pip install -r requirements.txt` and start command `python server.py`. The server reads the platform `PORT` environment variable.

## Scientific honesty
NASA observations are labelled separately from derived prototype calculations. The Moon has no substantial atmosphere, so atmospheric wind is not applicable. Earth analogue matching and landing physics are prototype models and should not be presented as NASA-certified engineering results.


## AI Mission Copilot (new)
- Context-aware chat receives selected lunar coordinates, site metrics, NASA query payload/status, lander configuration, and live simulator telemetry.
- Server-side Groq API integration; the API key is never exposed in frontend JavaScript.
- Prompt chips for site assessment, NASA-data interpretation, landing strategy, and mission briefings.
- AI responses are advisory and explicitly not certified flight guidance.

### Enable AI on Render
1. Create a Groq API key at https://console.groq.com/keys.
2. In Render → your Web Service → Environment, add `GROQ_API_KEY` (secret value).
3. Optional: set `GROQ_MODEL` (default `llama-3.3-70b-versatile`).
4. Redeploy. Open **AI MISSION COPILOT**. Without the key, the app explains configuration instead of pretending AI is online.

Local: PowerShell `$env:GROQ_API_KEY="your-key"; python server.py` (keep the key private; never commit it).

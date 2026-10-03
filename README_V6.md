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

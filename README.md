# Lunar Landing Analyzer — PROTOTYPE V3

This version keeps the 3D NASA lunar mosaic and adds a local Python data service that queries the NASA PDS Geosciences Node Granular Data System (GDS).

## What is now NASA-backed
- **Elevation/topography:** LRO LOLA RDR observations from NASA PDS GDS.
- **Local slope estimate:** calculated from nearby NASA LOLA topography observations using a local best-fit terrain plane.
- **Thermal/solar observations:** LRO Diviner RDR query, where data are available. Diviner brightness temperature is reported as a measured radiometric quantity, not mislabeled as a generic air temperature.
- **Solar incidence/azimuth/local time:** taken from Diviner observation fields when present.
- **Atmospheric wind:** N/A because the Moon has no substantial atmosphere.

## Still prototype / derived
- The 3D globe texture is a NASA LRO-derived color mosaic.
- Landing simulator physics are a simplified educational model, not flight-certified guidance software.
- Earth analogue matching is still a prototype module and should be upgraded with a documented Earth-data matching pipeline.

## Run on Windows
1. Install Python 3 if you do not already have it.
2. Double-click `START_WINDOWS.bat`.
3. Open **http://localhost:8000** in Chrome.
4. Click a point on the Moon and wait for the NASA query to finish.

The first NASA query can take several seconds. If NASA's GDS service is temporarily unavailable, the interface keeps the last successful result and clearly labels the data status.

## NASA references
- ODE: https://ode.rsl.wustl.edu/moon/
- ODE REST/GDS: https://oderest.rsl.wustl.edu/
- LRO LOLA PDS data: https://pds-geosciences.wustl.edu/missions/lro/lola.htm
- Diviner GDR: https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=LRO-L-DLRE-5-GDR-V1.0

# _archive/backend/app.py: Defines the main application for the GPRTool Demo API, handling backend operations and API endpoints.
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from geometry import make_box
from exporters import write_obj

app = FastAPI(title="GPRTool Demo API")

DATA = Path(__file__).resolve().parent / "data"
DATA.mkdir(exist_ok=True)

# --- NEW: point FastAPI to your repo's /frontend folder ---
BACKEND_DIR = Path(__file__).resolve().parent          # .../backend
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"         # .../frontend

# Serve all frontend assets (js/images/textures/styles.css/etc.)
# This makes URLs like /js/app.js or /images/logo.png work.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

@app.get("/api/health")
def health():
    return {"ok": True}

@app.get("/api/box")
def api_box(l: float = Query(20), w: float = Query(30), h: float = Query(40)):
    verts, tris = make_box(l, w, h)
    outfile = DATA / "box.obj"
    write_obj(verts, tris, outfile)
    return {"obj": "/download/box.obj"}

@app.get("/download/{name}")
def download(name: str):
    file = DATA / name
    if not file.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)
    return FileResponse(file)

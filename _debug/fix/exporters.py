# _archive/backend/exporters.py: Provides functionality for exporting 3D model data from the backend.
from pathlib import Path

def write_obj(verts, tris, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("# OBJ exported by GPRTool demo\n")
        for x, y, z in verts:
            f.write(f"v {x} {y} {z}\n")
        for i1, i2, i3 in tris:
            f.write(f"f {i1+1} {i2+1} {i3+1}\n")
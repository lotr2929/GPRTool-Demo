# geometry.py: Generates basic 3D shapes for the GPRTool demo.
"""
Simple geometry generation without FreeCAD dependency.
Generates basic 3D shapes for the GPRTool demo.
"""

def make_box(length=20.0, width=30.0, height=40.0):
    """
    Generate vertices and triangles for a box.
    Returns (vertices, triangles) ready for OBJ export.
    """
    l, w, h = length, width, height
    
    # 8 vertices of a box centered at origin
    vertices = [
        (0, 0, 0),      # 0: bottom-front-left
        (l, 0, 0),      # 1: bottom-front-right
        (l, w, 0),      # 2: bottom-back-right
        (0, w, 0),      # 3: bottom-back-left
        (0, 0, h),      # 4: top-front-left
        (l, 0, h),      # 5: top-front-right
        (l, w, h),      # 6: top-back-right
        (0, w, h),      # 7: top-back-left
    ]
    
    # 12 triangles (2 per face, 6 faces)
    triangles = [
        # Bottom face (z=0)
        (0, 1, 2), (0, 2, 3),
        # Top face (z=h)
        (4, 6, 5), (4, 7, 6),
        # Front face (y=0)
        (0, 5, 1), (0, 4, 5),
        # Back face (y=w)
        (3, 2, 6), (3, 6, 7),
        # Left face (x=0)
        (0, 3, 7), (0, 7, 4),
        # Right face (x=l)
        (1, 5, 6), (1, 6, 2),
    ]
    
    return vertices, triangles

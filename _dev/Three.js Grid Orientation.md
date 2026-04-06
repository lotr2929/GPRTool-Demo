Three.js Grid OrientationIn Three.js, the GridHelper is oriented on the X-Z plane by default. This means the grid lies "flat" on the ground, with the Y-axis serving as the vertical "Up" vector. In standard 3D Cartesian space, this aligns with:
X-axis: Left to Right (East/West)
Z-axis: Forward and Backward (North/South)
Y-axis: Up and Down (Elevation)

Aligning to "Design North"
You can certainly change the grid’s orientation to match Design North or any other arbitrary coordinate system. Since the GridHelper is a subclass of Object3D, you can manipulate its transformation matrix just like any other mesh.

1. Rotating to Design North
If your "Design North" is offset from "True North" (the Z-axis) by a specific angle, you can rotate the grid around its vertical axis (Y). For example, if your project's North is rotated 30° clockwise from True North:JavaScriptconst gridHelper = new THREE.GridHelper(100, 10);

// Convert degrees to radians
const angle = THREE.MathUtils.degToRad(30); 
gridHelper.rotation.y = angle;
scene.add(gridHelper);

2. Changing the Ground Plane
If your design coordinates define "North" as the Y-axis (common in 2D architectural drafting or SVG-style coordinates), you must rotate the grid 90 degrees to face the camera:JavaScript// Rotate 90 degrees around the X-axis to make the grid vertical (X-Y plane)
gridHelper.rotation.x = Math.PI / 2;

3. Using a Container for Complex Offsets
For more complex scenarios where you need to align with a specific site survey or BIM model, it is often best to wrap the grid in a Group. You can then apply the "Design North" rotation to the group, allowing you to move or scale the grid independently within that local coordinate system.

Technical Considerations
Precision: When working with large-scale coordinates (like UTM or global survey data), Three.js can encounter "jitter" due to 32-bit float precision. It is best to keep your "Design North" origin at $(0, 0, 0)$ and offset your world objects instead.
Visual Direction: If you need to visualize the difference between True North and Design North, you can use an ArrowHelper to represent the True North vector relative to your rotated grid.
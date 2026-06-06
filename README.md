# VRM Exporter

A JavaScript library for exporting VRM 0.0/1.0 format models. Built with Three.js.

## Overview

`VRMExporter.js` is a module that analyzes VRM instances loaded with [three-vrm](https://github.com/pixiv/three-vrm) and exports them in VRM1.0 or VRM0.0 file format.

## Installation

```bash
npm install
```

This project uses the following dependencies:
- Three.js

(The sample HTML files also use three-vrm)

## Usage

The following example shows how to export a VRM instance loaded with `three-vrm` to a `model.vrm` file.

```javascript
import { VRMExport } from './src/VRMExporter.js';

// Load a VRM file using three-vrm's VRMLoaderPlugin
// The following vrm is a VRM instance loaded with three-vrm

// Export the VRM instance as VRM0 or VRM1
const buffer = await VRMExport(vrm, 1); // 1 = VRM1, 0 = VRM0

// Convert buffer to Blob and download
const blob = new Blob([buffer], { type: 'application/octet-stream' });
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'model.vrm';
a.click();
```

## Sample Programs

Three sample programs are included.

### [basic.html](https://ringo3apples.github.io/vrm-exporter/examples/basic.html) 
- Opens a sample VRM model and displays it with `Three.js`
- Press **Export as VRM0** or **Export as VRM1** to export the model
- Drag and drop VRM0.0 or VRM1.0 files to load and display them
- Can be used as a converter between VRM0 and VRM1

### [halo.html](https://ringo3apples.github.io/vrm-exporter/examples/halo.html) 
- Press **Add Halo** to attach a `RingGeometry` to the VRM model
- Press **Export as VRM0** or **Export as VRM1** to export the model
- Drag and drop a VRM file to load it and add a halo effect to the model

### [color.html](https://ringo3apples.github.io/vrm-exporter/examples/color.html) 
- Select a `Material` using the dropdown menu and change the VRM model's color with the color picker
- Press **Export as VRM0** or **Export as VRM1** to export the model
- Drag and drop a VRM file to load it and change the colors of the model

## File Structure

- `src/VRMExporter.js` - Main exporter module
- `examples/basic.html` - Basic demo HTML
- `examples/color.html` - Material adjustment demo HTML
- `examples/halo.html` - Mesh addition demo HTML
- `models/` - Sample VRM models

## License

MIT License

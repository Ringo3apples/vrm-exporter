# VRM Exporter

A JavaScript library for converting and exporting VRM 0.0/1.0 format models. Built with Three.js.

## Overview

`VRMExporter.js` is a module that analyzes VRM instances loaded with three-vrm and exports them in VRM1.0 or VRM0.0 file format.

## Installation

```bash
npm install
```

This project uses the following dependencies:
- Three.js

(The sample HTML also uses three-vrm)

## Usage

### Basic Example

Open `examples/basic.html` in your browser:

1. Load a sample VRM model
2. Press the 'Export as VRM0' or 'Export as VRM1' button to export
3. Download the exported file

### Programmatic Usage

```javascript
import { VRMExport } from './src/VRMExporter.js';

// Export a VRM instance as VRM0 or VRM1
const buffer = await VRMExport(vrm, 1); // 1 = VRM1, 0 = VRM0

// Convert buffer to Blob and download
const blob = new Blob([buffer], { type: 'application/octet-stream' });
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'model.vrm';
a.click();
```

*Note: `vrm` is a VRM instance loaded with three-vrm.*

## File Structure

- `src/VRMExporter.js` - Main exporter module
- `examples/basic.html` - Demo HTML
- `models/` - Sample VRM models

## License

MIT License

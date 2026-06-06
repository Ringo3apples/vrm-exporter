# VRM Exporter

VRM 0.0/1.0 形式のモデルを変換・エクスポートするJavaScript ライブラリです。Three.js ベースです。

## 概要

`VRMExporter.js` は、three-vrmで読み込んだ VRM インスタンスを解析し、VRM1 または VRM0 のファイル形式でエクスポートするモジュールです。

## インストール

```bash
npm install
```

このプロジェクトは以下の依存関係を使用します：
- Three.js

（サンプル HTML では three-vrm も使用します）

## 使用方法

### basic example

`examples/basic.html` をブラウザで開いて実行します：

1. サンプルのVRMモデルを読み込みます
2. 'Export as VRM0' または 'Export as VRM1' のボタンを押すとエクスポートされます
3. エクスポート

### プログラムでの使用

```javascript
import { VRMExport } from './src/VRMExporter.js';

// VRM インスタンスを VRM0 または VRM1 で書き出す
const buffer = await VRMExport(vrm, 1); // 1 = VRM1, 0 = VRM0

// バッファを Blob に変換してダウンロード
const blob = new Blob([buffer], { type: 'application/octet-stream' });
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'model.vrm';
a.click();
```

※ `vrm` は three-vrm で読み込んだ VRM インスタンスです。

## ファイル構成

- `src/VRMExporter.js` - メインのエクスポーター モジュール
- `examples/basic.html` - デモ HTML
- `models/` - サンプル VRM モデル

## ライセンス

MIT License
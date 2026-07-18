# VRM Exporter

VRM 0.0/1.0 形式のモデルをエクスポートするJavaScript ライブラリです。Three.js ベースです。

## 概要

`VRMExporter.js` は、[three-vrm](https://github.com/pixiv/three-vrm)で読み込んだ VRM インスタンスを解析し、VRM1.0 または VRM0.0 のファイル形式でエクスポートするモジュールです。

## インストール

```bash
npm install
```

このプロジェクトは以下の依存関係を使用します：
- Three.js

（サンプル HTML では three-vrm も使用します）

## 使用方法

下記は，`three-vrm` で読み込んだ VRM インスタンスを `model.vrm` ファイルに書き出す例です。

```javascript
import { VRMExport } from './src/VRMExporter.js';

// three-vrm VRMLoaderPlugin で，VRMファイルを読み込みます
// 以下の vrm は three-vrm で読み込んだ VRM インスタンスです。

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

## サンプルプログラム

3種のサンプルを用意しています。

### [basic.html](https://ringo3apples.github.io/vrm-exporter/examples/basic.html) 
- ブラウザで開くと，サンプルのVRMモデルを読み込み，`Three.js` で表示します。
- **Export as VRM0** または **Export as VRM1** のボタンを押すとエクスポートします。
- VRM0.0もしくはVRM1.0のファイルをドラッグ・ドロップすると読み込んで表示します。
- VRM0↔️VRM1の間のコンバータとして使えます。

### [halo.html](https://ringo3apples.github.io/vrm-exporter/examples/halo.html) 
- **Add Halo** ボタンを押すと，VRMモデルに，`RingGeometory` を取り付けます。
- **Export as VRM0** または **Export as VRM1** のボタンを押すとエクスポートします。
- VRMファイルをドラッグ・ドロップして，読み込んだモデルに天使の輪を取り付けることができます。

### [color.html](https://ringo3apples.github.io/vrm-exporter/examples/color.html) 
- ラジをボタンで `Material` を選択し，カラーピッカーでVRMモデルの色を変更できます。
- **Export as VRM0** または **Export as VRM1** のボタンを押すとエクスポートします。
- VRMファイルをドラッグ・ドロップして，読み込んだモデルの色変えができます。

## ファイル構成

- `src/VRMExporter.js` - メインのエクスポーター モジュール
- `examples/basic.html` - 基本的なデモ HTML
- `examples/color.html` - マテリアル調整のデモ HTML
- `examples/halo.html` - メッシュ追加のデモ HTML
- `models/` - サンプル VRMモデル

## 注意事項 (Note)

- node_constraint は，VRM0.0では無視されます。
- Expression の MaterialColorBind と TextureTransformBind に対応しました。(2026/07/18)

## ライセンス

MIT License

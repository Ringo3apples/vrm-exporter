import * as THREE from 'three';

const ComponentType = {
    signedByte: 5120,
    unsignedByte: 5121,
    signedShort: 5122,
    unsignedShort: 5123,
    unsignedInt: 5125,
    float: 5126,
    Int8Array: 5120,
    Uint8Array: 5121,
    Int16Array: 5122,
    Uint16Array: 5123,
    Int32Array: 5124, //May not be used
    Uint32Array: 5125,
    Float32Array: 5126,
}

const ItemSize = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16
}

const ComponentFunc = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5124: Int32Array,
    5125: Uint32Array,
    5126: Float32Array,
}

export function splitBuffer(vrmBuffer) {
    const view = new DataView(vrmBuffer);
    const magic = view.getUint32(0, true);
    if (magic !== 0x46546C67) return error('Not a VRM File (magic).');
    const version = view.getUint32(4, true);
    if (version !== 2) return error('VRM version must be 2.');
    const length = view.getUint32(8, true);
    if (length !== vrmBuffer.byteLength) return error('Data length mismatch.');

    const jsonChunkDataLength = view.getUint32(12, true);
    const jsonChunkType = view.getUint32(16, true);
    if (jsonChunkType !== 0x4E4F534A) return console.error('First chunk is not JSON');
    const jsonChunkData = vrmBuffer.slice(20, 20 + jsonChunkDataLength);

    const binChunkOffset = 20 + jsonChunkDataLength;
    const binChunkDataLength = view.getUint32(binChunkOffset, true);
    const binChunkType = view.getUint32(binChunkOffset + 4, true);
    if (binChunkType !== 0x004E4942) return console.error('Second chunk is not BIN');
    const binChunkData = vrmBuffer.slice(binChunkOffset + 8, binChunkOffset + 8 + binChunkDataLength);
    return { jsonChunkData, binChunkData, jsonChunkDataLength, binChunkDataLength };
}

export function bindBuffers({ jsonChunkData, binChunkData }) {
    const totalLength = 12 + 8 + jsonChunkData.byteLength + 8 + binChunkData.byteLength;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    let offset = 0;
    view.setUint32(offset, 0x46546C67, true); offset += 4;
    view.setUint32(offset, 2, true); offset += 4;
    view.setUint32(offset, totalLength, true); offset += 4;

    view.setUint32(offset, jsonChunkData.byteLength, true); offset += 4;
    view.setUint32(offset, 0x4E4F534A, true); offset += 4;
    uint8.set(new Uint8Array(jsonChunkData), offset); offset += jsonChunkData.byteLength;

    view.setUint32(offset, binChunkData.byteLength, true); offset += 4;
    view.setUint32(offset, 0x004E4942, true); offset += 4;
    uint8.set(new Uint8Array(binChunkData), offset);

    return buffer;
}

export async function getData({ jsonChunkData, binChunkData }) {
    const jsonText = new TextDecoder().decode(jsonChunkData);
    const json = JSON.parse(jsonText);
    const imageBitmaps = [];
    for (let i = 0; i < json.images.length; i++) {
        const image = json.images[i];
        const bufferView = json.bufferViews[image.bufferView];
        const imageBuffer = binChunkData.slice(bufferView.byteOffset, bufferView.byteOffset + bufferView.byteLength);
        const blob = new Blob([imageBuffer], { type: image.mimeType });
        imageBitmaps[i] = await createImageBitmap(blob);
    }

    const data = [];
    for (let i = 0; i < json.accessors.length; i++) {
        const accessor = json.accessors[i];
        const itemSize = ItemSize[accessor.type];
        const length = itemSize * accessor.count;
        const bufferView = json.bufferViews[accessor.bufferView];
        const ArrayType = ComponentFunc[accessor.componentType];
        let array = null;
        if (accessor.bufferView !== undefined) {
            const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
            array = new ArrayType(binChunkData, byteOffset, length);
        } else {
            array = new ArrayType(length);
        }
        if (accessor.sparse) {
            const s = accessor.sparse;
            const indicesBufferView = json.bufferViews[s.indices.bufferView];
            const indicesByteOffset = (indicesBufferView.byteOffset || 0) + (s.indices.byteOffset || 0);
            const indicesArrayType = ComponentFunc[s.indices.componentType];
            const indices = new indicesArrayType(binChunkData, indicesByteOffset, s.count);

            const valuesBufferView = json.bufferViews[s.values.bufferView];
            const valuesByteOffset = (valuesBufferView.byteOffset || 0) + (s.values.byteOffset || 0);
            const valuesArrayType = ComponentFunc[accessor.componentType];
            const values = new valuesArrayType(binChunkData, valuesByteOffset, s.count * itemSize);

            for (let j = 0; j < s.count; j++) {
                for (let k = 0; k < itemSize; k++) {
                    array[itemSize * indices[j] + k] = values[itemSize * j + k];
                }
            }
        }
        data.push(array);
    }
    return { json, imageBitmaps, data };
}

export async function putData({ json, imageBitmaps, data }) {
    const newBufferViews = [];
    const arrays = [];
    let byteOffset = 0;
    for (let i = 0; i < json.images.length; i++) {
        const canvas = document.createElement('canvas');
        canvas.width = imageBitmaps[i].width;
        canvas.height = imageBitmaps[i].height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imageBitmaps[i], 0, 0);
        const blob = await new Promise(resolve =>
            canvas.toBlob(resolve, 'image/png')
        );
        const imageBuffer = await blob.arrayBuffer();

        const byteLength = imageBuffer.byteLength;
        const byteLength4 = (byteLength + 3) & ~3;
        const bufferView = { buffer: 0, byteLength, byteOffset };
        byteOffset += byteLength4;
        json.images[i].bufferView = newBufferViews.length;
        json.images[i].mimeType = 'image/png';
        newBufferViews.push(bufferView);
        const array = new Uint8Array(byteLength4);
        array.set(new Uint8Array(imageBuffer));
        arrays.push(array);
    }
    const newAccessors = [];
    for (let i = 0; i < json.accessors.length; i++) {
        const accessor = json.accessors[i];
        const byteLength = data[i].byteLength;
        const byteLength4 = (byteLength + 3) & ~3;
        const bufferView = { buffer: 0, byteLength, byteOffset };
        byteOffset += byteLength4;
        newAccessors[i] = { type: accessor.type, count: accessor.count, componentType: accessor.componentType, byteOffset: 0 };
        newAccessors[i].bufferView = newBufferViews.length;
        if (accessor.normalized) newAccessors[i].normalized = json.accessors[i].normalized;
        if (accessor.min) newAccessors[i].min = json.accessors[i].min;
        if (accessor.max) newAccessors[i].max = json.accessors[i].max;
        newBufferViews.push(bufferView);
        const array = new Uint8Array(byteLength4);
        array.set(new Uint8Array(data[i].buffer, data[i].byteOffset, data[i].byteLength));
        arrays.push(array);
    }
    json.accessors = newAccessors;
    const binChunkData = new ArrayBuffer(byteOffset);
    const binView = new Uint8Array(binChunkData);
    for (let i = 0; i < arrays.length; i++) {
        binView.set(arrays[i], newBufferViews[i].byteOffset);
    }
    json.bufferViews = newBufferViews;
    json.buffers = [{ byteLength: binChunkData.byteLength }];
    const jsonText = JSON.stringify(json);
    const jsonBuffer = new TextEncoder().encode(jsonText);
    const byteLength = (jsonBuffer.length + 3) & ~3;
    const jsonChunkData = new Uint8Array(byteLength);
    jsonChunkData.set(jsonBuffer);
    jsonChunkData.fill(0x20, jsonBuffer.length);

    return { jsonChunkData, binChunkData };
}

function rotateGeometry({ json, data }) {
    const toInvert = new Set();
    if (json.meshes) {
        json.meshes.forEach(mesh => {
            mesh.primitives.forEach(primitive => {
                const attributes = primitive.attributes;
                if (attributes.POSITION !== undefined) toInvert.add(attributes.POSITION);
                if (attributes.NORMAL !== undefined) toInvert.add(attributes.NORMAL);
                if (primitive.targets) {
                    primitive.targets.forEach(target => {
                        if (target.POSITION !== undefined) toInvert.add(target.POSITION);
                        if (target.NORMAL !== undefined) toInvert.add(target.NORMAL);
                    });
                }
            });
        });
    }

    toInvert.forEach(index => {
        const accessor = json.accessors[index];
        //const vectors = data[accessor.bufferView];
        const vectors = data[index];
        if (accessor && vectors && accessor.type === 'VEC3') {
            for (let i = 0; i < vectors.length; i += 3) {
                vectors[i] = -vectors[i];
                vectors[i + 2] = -vectors[i + 2];
            }
        } else {
            console.warn('Accessor to invert is not VEC3 or has no data', accessor);
        }
        if (accessor.min && accessor.max) {
            const maxX = accessor.max[0];
            const maxZ = accessor.max[2];
            accessor.max[0] = -accessor.min[0];
            accessor.max[2] = -accessor.min[2];
            accessor.min[0] = -maxX;
            accessor.min[2] = -maxZ;
        }
    });
    json.skins.forEach(skin => {
        if (skin.inverseBindMatrices !== undefined) {
            const accessor = json.accessors[skin.inverseBindMatrices];
            //const matrices = data[accessor.bufferView];
            const matrices = data[skin.inverseBindMatrices];

            for (let i = 0; i < matrices.length; i += 16) {
                // Translation
                matrices[i + 12] = -matrices[i + 12];
                matrices[i + 14] = -matrices[i + 14];
                // Rotation
                matrices[i + 1] = -matrices[i + 1];
                matrices[i + 4] = -matrices[i + 4];
                matrices[i + 6] = -matrices[i + 6];
                matrices[i + 9] = -matrices[i + 9];
            }
        }
    });
}

function rotateBones({ json }) {
    json.nodes.forEach(node => {
        if (node.translation) {
            node.translation[0] = -node.translation[0]; // X
            node.translation[2] = -node.translation[2]; // Z
        }
        if (node.rotation) {
            const [x, y, z, w] = node.rotation;
            node.rotation = [-x, y, -z, w];
        }
    });
    const firstPersonBoneOffset = json.extensions.VRM.firstPerson.firstPersonBoneOffset;
    firstPersonBoneOffset.x = -firstPersonBoneOffset.x;
    firstPersonBoneOffset.z = -firstPersonBoneOffset.z;
}

function convertSpringBones({ json }) {
    const spring = json.extensions.VRM.secondaryAnimation;
    if (!spring) return;
    (spring.colliderGroups || []).forEach((group, groupIndex) => {
        const colliderIndices = [];
        group.colliders.forEach(collider => {
            collider.offset.x = -collider.offset.x ?? 0;
            collider.offset.z = -collider.offset.z ?? 0;
        });
    });
}

function extractThumbnail({ json, imageBitmaps, data }) {
    let thumbnailImage = null;
    if (json.extensions.VRM) {
        const textureIndex = json.extensions.VRM.meta.texture;
        if (textureIndex != undefined && textureIndex != null && textureIndex >= 0) {
            thumbnailImage = json.textures[textureIndex].source;
        }
    }
    if (json.extensions.VRMC_vrm) {
        thumbnailImage = json.extensions.VRMC_vrm.meta.thumbnailImage;
    }
    if (thumbnailImage != undefined && thumbnailImage != null && thumbnailImage >= 0) {
        return imageBitmaps[thumbnailImage];
    }
    return null;
}

function convertMeta(vrm) {
    if (vrm.meta.metaVersion == '1') return;

    //const meta = gltf.parser.json.extensions.VRM.meta;
    const meta = vrm.meta;
    const newMeta = { metaVersion: "1" };

    if (meta.licenseUrl) {
        newMeta.licenseUrl = meta.licenseUrl;
    } else {
        newMeta.licenseUrl = "https://vrm.dev/licenses/1.0/";
    }
    if (meta.author) newMeta.authors = [meta.author];
    if (meta.title) newMeta.name = meta.title;
    if (meta.version) newMeta.version = meta.version;

    if (meta.contactInformation) newMeta.contactInformation = meta.contactInformation;
    switch (meta.allowedUserName) {
        case "OnlyAuthor": newMeta.avatarPermission = 'onlyAuthor'; break;
        case "ExplicitlyLicensedPerson": newMeta.avatarPermission = 'onlySeparatelyLicensedPerson'; break;
        case "Everyone": newMeta.avatarPermission = 'everyone'; break;
        default: newMeta.avatarPermission = 'onlyAuthor';
    }
    newMeta.allowExcessivelyViolentUsage = meta.violentUssageName == 'Allow';
    newMeta.allowExcessivelySexualUsage = meta.sexualUssageName == 'Allow';
    if (meta.otherPermissionUrl) newMeta.otherLicenseUrl = meta.otherPermissionUrl;

    switch (meta.licenseName) {
        case "Redistribution_Prohibited": {
            newMeta.allowRedistribution = false;
            newMeta.modification = 'prohibited';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = meta.commercialUssageName == 'Allow' ? "corporation" : "personalProfit";
            break;
        }
        case "CC0": {
            newMeta.allowRedistribution = true;
            newMeta.modification = 'allowModificationRedistribution';
            newMeta.creditNotation = 'unnecessary';
            newMeta.commercialUsage = "corporation";
            break;
        }
        case "CC_BY": {
            newMeta.allowRedistribution = true;
            newMeta.modification = 'allowModificationRedistribution';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = meta.commercialUssageName == 'Allow' ? "corporation" : "personalProfit";
            break;
        }
        case "CC_BY_NC": {
            newMeta.allowRedistribution = true;
            newMeta.modification = 'allowModificationRedistribution';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = "personalNonProfit";
            break;
        }
        case "CC_BY_SA": {
            newMeta.allowRedistribution = true;
            newMeta.modification = 'allowModificationRedistribution';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = meta.commercialUssageName == 'Allow' ? "corporation" : "personalProfit";
            break;
        }
        case "CC_BY_NC_SA": {
            newMeta.allowRedistribution = true;
            newMeta.modification = 'allowModificationRedistribution';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = "personalNonProfit";
            break;
        }
        case "CC_BY_ND": {
            newMeta.allowRedistribution = true;
            newMeta.modification = 'prohibited';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = meta.commercialUssageName == 'Allow' ? "corporation" : "personalProfit";
            break;
        }
        case "CC_BY_NC_ND": {
            newMeta.allowRedistribution = true;
            newMeta.modification = 'prohibited';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = "personalNonProfit";
            break;
        }
        default: {
            newMeta.allowRedistribution = false;
            newMeta.modification = 'prohibited';
            newMeta.creditNotation = 'required';
            newMeta.commercialUsage = "personalNonProfit";
            break;
        }
    }
    newMeta.allowPoliticalOrReligiousUsage = false;
    newMeta.allowAntisocialOrHateUsage = false;
    newMeta.copyrightInformation = '';
    newMeta.thirdPartyLicenses = '';

    vrm.meta = newMeta;
}

function correctExpression({ json }) {
    const blendShapeGroups = json.extensions?.VRM?.blendShapeMaster?.blendShapeGroups;
    if (blendShapeGroups && blendShapeGroups.length > 0) {
        blendShapeGroups.forEach(shape => {
            if (shape.name == 'Surprised') {
                shape.name = 'surprised';
                shape.presetName = 'surprised'
            }
        });
    }
}

function addSpringBoneEnds(vrm) {
    vrm.springBoneManager.joints.forEach(joint => {
        if (joint.child == null) {
            const end = new THREE.Object3D();
            end.name = joint.bone.name + '_end';
            const position = joint.bone.position.clone().setLength(0.07);
            end.position.set(position.x, position.y, position.z);
            joint.bone.add(end);
            joint.child = end;
        }
    });
}

export const conversion = {
    async before(vrmBuffer) {
        const res = splitBuffer(vrmBuffer);
        const { json, imageBitmaps, data } = await getData(res);

        if (json.extensions.VRM) {
            rotateGeometry({ json, data });
            rotateBones({ json, data });
            convertSpringBones({ json });
            correctExpression({ json });
        }

        const thumbnail = extractThumbnail({ json, imageBitmaps, data });
        const buffers = await putData({ json, imageBitmaps, data })
        const buffer = bindBuffers(buffers);
        return { buffer, thumbnail };
    },
    after(vrm, thumbnail) {
        if (vrm.meta.metaVersion == '0') {
            convertMeta(vrm);
            addSpringBoneEnds(vrm);
        }
        vrm.meta.thumbnailImage = thumbnail;
        return vrm;
    }
}

function init(state) {
    state.accessors = [];
    state.asset = {
        version: "2.0",
        generator: "VRMExporterByRingo"
    };
    state.bufferViews = [];
    state.buffers = [];
    state.extensions = {};
    state.extensions.VRMC_vrm = { specVersion: '1.0' };
    state.extensions.VRM = { specVersion: '0.0' };
    state.extensionsUsed = ["KHR_texture_transform", "KHR_materials_unlit"];
    state.images = [];
    state.materials = [];
    state.meshes = [];
    state.nodes = [];
    state.samplers = [];
    state.scene = 0;
    state.scenes = [{ nodes: [] }];
    state.skins = [];
    state.textures = []
    state.offset = 0;

    state.nodeMap = new Map();
    state.textureMap = new Map();
    state.samplerMap = new Map();
    state.imageMap = [];
    state.makeMeshQueues = [];
    state.primitiveMap = new Map();
    state.meshMap = new Map();
    state.materialMap = new Map();
    state.accessorMap = new Map();
    state.materialQueue = [];

    state.translationZero = new THREE.Vector3();
    state.quaternionZero = new THREE.Quaternion();
    state.scaleOne = new THREE.Vector3(1, 1, 1);
}

function align4(n) {
    return Math.ceil(n / 4) * 4;
}

function addBufferView(state, data, name = '', target = null) {
    const bufferView = {};
    bufferView.buffer = 0;
    bufferView.byteLength = data.byteLength;
    bufferView.byteOffset = state.offset;
    if (target == 'ARRAY_BUFFER') bufferView.target = 34963;
    if (target == 'ELEMENT_ARRAY_BUFFER') bufferView.target = 34962;
    bufferView.name = name;

    const index = state.bufferViews.length;
    state.bufferViews.push(bufferView);
    state.buffers.push(data);
    state.offset += align4(data.byteLength);

    return index;
}

function addAccessor(state, array, dataType, name = '', maxMin = false, normalized = false) {
    if (state.accessorMap.has(array)) return state.accessorMap.get(array);
    const accessor = { name };
    accessor.componentType = ComponentType[array.constructor.name];
    accessor.bufferView = addBufferView(state, array, name);
    accessor.byteOffset = 0;
    const itemSize = ItemSize[dataType];
    accessor.count = array.length / itemSize;
    accessor.type = dataType;
    accessor.normalized = normalized;

    if (maxMin) {
        const min = new Array(itemSize);
        const max = new Array(itemSize);
        min.fill(Infinity);
        max.fill(-Infinity);
        for (let i = 0; i < accessor.count; i++) {
            const index = itemSize * i;
            for (let j = 0; j < itemSize; j++) {
                if (array[index + j] < min[j]) min[j] = array[index + j];
                if (array[index + j] > max[j]) max[j] = array[index + j];
            }
        }
        accessor.max = max;
        accessor.min = min;
    }

    const index = state.accessors.length;
    state.accessors.push(accessor);
    state.accessorMap.set(array, index);
    return index;
}

const MAG_FILTER = {
    [THREE.NearestFilter]: 9728, // NEAREST
    [THREE.LinearFilter]: 9729   // LINEAR
};
const MIN_FILTER = {
    [THREE.NearestFilter]: 9728,
    [THREE.LinearFilter]: 9729,
    [THREE.NearestMipmapNearestFilter]: 9984,
    [THREE.LinearMipmapNearestFilter]: 9985,
    [THREE.NearestMipmapLinearFilter]: 9986,
    [THREE.LinearMipmapLinearFilter]: 9987
};
const WRAP = {
    [THREE.ClampToEdgeWrapping]: 33071,
    [THREE.MirroredRepeatWrapping]: 33648,
    [THREE.RepeatWrapping]: 10497
};

function addSampler(state, target) {
    const sampler = {
        magFilter: MAG_FILTER[target.magFilter] ?? 9729,
        minFilter: MIN_FILTER[target.minFilter] ?? 9987,
        wrapS: WRAP[target.wrapS] ?? 10497,
        wrapT: WRAP[target.wrapT] ?? 10497
        //extensions: {},
        //extras: {}
    };
    const key = `${sampler.magFilter}_${sampler.minFilter}_${sampler.wrapS}_${sampler.wrapT}`;
    if (state.samplerMap.has(key)) return state.samplerMap.get(key);

    const index = state.samplers.length;
    state.samplers.push(sampler);
    state.samplerMap.set(key, index);
    return index;
}

function imageBitmapToPNG(imageBitmap, flipY = false) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;

        const ctx = canvas.getContext("2d");
        if (flipY) {
            ctx.translate(0, canvas.height);
            ctx.scale(1, -1);
        }
        ctx.drawImage(imageBitmap, 0, 0);

        canvas.toBlob(async (blob) => {
            const png = await blob.arrayBuffer();
            resolve(png);
        }, "image/png");
    });
}

async function addImage(state, target, name = '', flipY) {
    const imageIndex = state.imageMap.findIndex((v) => v == target);
    if (imageIndex >= 0) return imageIndex;

    const png = await imageBitmapToPNG(target, flipY);
    const image = {
        bufferView: addBufferView(state, new Uint8Array(png), 'Image: ' + name),
        mimeType: "image/png",
        name: name,
    };
    const index = state.images.length;
    state.images.push(image);
    state.imageMap.push(target);
    return index;
}

async function addTexture(state, target) {
    const texture = {
        name: target.name,
        sampler: addSampler(state, target),
        source: await addImage(state, target.source.data, target.name, target.flipY),
    };

    const res = {};
    const key = JSON.stringify(texture);
    if (state.textureMap.has(key)) {
        res.index = state.textureMap.get(key);
    } else {
        const index = state.textures.length;
        state.textures.push(texture);
        state.textureMap.set(key, index);
        res.index = index;
    }

    if (target.offset.x != 0 || target.offset.y != 0 || target.repeat.x != 1 || target.repeat.y != 1) {
        res.extensions = {
            KHR_texture_transform: {
                offset: [target.offset.x, target.offset.y],
                scale: [target.repeat.x, target.repeat.y]
            }
        };
    }
    //res.texCoord = 0;
    //res.extra = {};

    return res;
}
async function makeMToon(state, main, renderOrder) {
    const mToon = { specVersion: "1.0" };

    if (main.depthWrite) {
        mToon.transparentWithZWrite = true;
        if (renderOrder != 0) mToon.renderQueueOffsetNumber = renderOrder;
    } else {
        if (renderOrder != 19) mToon.renderQueueOffsetNumber = renderOrder - 19;
    }
    if (main.shadeColorFactor) {
        mToon.shadeColorFactor = [main.shadeColorFactor.r, main.shadeColorFactor.g, main.shadeColorFactor.b];
    } else {
        mToon.shadeColorFactor = [0, 0, 0];
    }
    if (main.shadeMultiplyTexture) {
        mToon.shadeMultiplyTexture = await addTexture(state, main.shadeMultiplyTexture);
    }
    if (main.shadingShiftFactor != 0)
        mToon.shadingShiftFactor = main.shadingShiftFactor;
    if (main.shadingShiftTexture) {
        mToon.shadingShiftTexture = await addTexture(state, main.shadingShiftTexture);
    }
    if (main.shadingToonyFactor != 0.9)
        mToon.shadingToonyFactor = main.shadingToonyFactor;
    if (main.giEqualizationFactor != 0.9)
        mToon.giEqualizationFactor = main.giEqualizationFactor;

    if (main.matcapFactor && main.matcapFactor.getHex() != 16777215)
        mToon.matcapFactor = [main.matcapFactor.r, main.matcapFactor.g, main.matcapFactor.b];
    if (main.matcapTexture)
        mToon.matcapTexture = await addTexture(state, main.matcapTexture);

    if (main.parametricRimColorFactor && main.parametricRimColorFactor.getHex() != 0)
        mToon.parametricRimColorFactor = [main.parametricRimColorFactor.r, main.parametricRimColorFactor.g, main.parametricRimColorFactor.b];
    if (main.rimMultiplyTexture)
        mToon.rimMultiplyTexture = await addTexture(state, main.rimMultiplyTexture);
    if (main.rimLightingMixFactor != 1)
        mToon.rimLightingMixFactor = main.rimLightingMixFactor;
    if (main.parametricRimFresnelPowerFactor != 5)
        mToon.parametricRimFresnelPowerFactor = main.parametricRimFresnelPowerFactor;
    if (main.parametricRimLiftFactor != 0)
        mToon.parametricRimLiftFactor = main.parametricRimLiftFactor;

    if (main.outlineWidthMode != 'none')
        mToon.outlineWidthMode = main.outlineWidthMode;
    if (main.outlineWidthFactor != 0)
        mToon.outlineWidthFactor = main.outlineWidthFactor;
    if (main.outlineWidthMultiplyTexture)
        mToon.outlineWidthMultiplyTexture = await addTexture(state, main.outlineWidthMultiplyTexture);

    if (main.outlineColorFactor && main.outlineColorFactor.getHex() != 0)
        mToon.outlineColorFactor = [main.outlineColorFactor.r, main.outlineColorFactor.g, main.outlineColorFactor.b];
    if (main.outlineLightingMixFactor != 1)
        mToon.outlineLightingMixFactor = main.outlineLightingMixFactor;

    if (main.uvAnimationMaskTexture)
        mToon.uvAnimationMaskTexture = await addTexture(state, main.uvAnimationMaskTexture);
    if (main.uvAnimationScrollXSpeedFactor != 0)
        mToon.uvAnimationScrollXSpeedFactor = main.uvAnimationScrollXSpeedFactor;
    if (main.uvAnimationScrollYSpeedFactor != 0)
        mToon.uvAnimationScrollYSpeedFactor = main.uvAnimationScrollYSpeedFactor;
    if (main.uvAnimationRotationSpeedFactor != 0)
        mToon.uvAnimationRotationSpeedFactor = main.uvAnimationRotationSpeedFactor;

    if (!state.extensionsUsed.includes('VRMC_materials_mtoon')) state.extensionsUsed.push('VRMC_materials_mtoon');

    const index = state.materials.length - 1;
    state.materials[index].extensions.VRMC_materials_mtoon = mToon;
}

function gamma(color, alpha = null) {
    //const c = []
    const c = color.clone().convertLinearToSRGB().toArray();
    if (alpha != null) c.push(alpha);
    return c;
}

async function makeMaterialProperties(state, main, renderOrder) {
    const properties = { name: main.name, shader: "VRM/MToon", renderQueue: 2450 };

    const floatProperties = properties.floatProperties = {};
    const vectorProperties = properties.vectorProperties = {};
    const textureProperties = properties.textureProperties = {};
    const keywordMap = properties.keywordMap = {};
    const tagMap = properties.tagMap = {};

    let renderType = '';

    async function addTexture2(texture, dist) {
        textureProperties[dist] = (await addTexture(state, texture)).index;
        vectorProperties[dist] = [texture.offset.x, texture.offset.y, texture.repeat.x, texture.repeat.y];
    }

    if (main.transparent == false && main._alphaTest == 0) {
        // OPAQUE
        tagMap.RenderType = 'Opaque';
        renderType = 'Opaque';
        keywordMap._ALPHABLEND_ON = false;
        keywordMap._ALPHATEST_ON = false;
    }
    if (main.transparent == false && main._alphaTest != 0) {
        // MASK
        tagMap.RenderType = 'TransparentCutout';
        renderType = 'TransparentCutout';
        keywordMap._ALPHATEST_ON = true;
        floatProperties._BlendMode = 1;
        floatProperties._Cutoff = main.alphaTest;
    }
    if (main.transparent == true) {
        // BLEND
        tagMap.RenderType = 'Transparent';
        keywordMap._ALPHABLEND_ON = true;
        floatProperties._BlendMode = 2;
        floatProperties._ZWrite = main.depthWrite ? 1 : 0;
        if (main.depthWrite) {
            renderType = 'TransparentWithZWrite';
        } else {
            renderType = 'Transparent';
        }
        floatProperties._Cutoff = main.alphaTest;
    }

    if (main.side === 2) {
        //DoubleSide
        floatProperties._CullMode = 0;
    } else if (main.side === 0) {
        //Front
        floatProperties._CullMode = 2;
    } else {
        //Back
        floatProperties._CullMode = 1;
    }

    if (main.color) vectorProperties._Color = gamma(main.color, main.opacity);
    if (main.map) await addTexture2(main.map, '_MainTex');

    if (main.emissive) vectorProperties._EmissionColor = gamma(main.emissive, 1);
    if (main.emissiveMap) await addTexture2(main.emissiveMap, '_EmissionMap');

    if (main.normalScale) floatProperties._BumpScale = main.normalScale.x;
    if (main.normalMap) {
        await addTexture2(main.normalMap, '_BumpMap');
        keywordMap._NORMALMAP = true;
    }

    vectorProperties._ShadeColor = [0, 0, 0, 1];
    if (main.shadeColorFactor) vectorProperties._ShadeColor = gamma(main.shadeColorFactor, main.opacity);
    if (main.shadeMultiplyTexture) {
        textureProperties._ShadeTexture = (await addTexture(state, main.shadeMultiplyTexture)).index;
    }

    const shadingToonyFactor = main.shadingToonyFactor ?? 0.9;
    const shadingShiftFactor = main.shadingShiftFactor ?? 0.0;
    const x = shadingToonyFactor - shadingShiftFactor - 1;
    const t = 0.5 + 0.5 * x;
    const y = (shadingToonyFactor - t) / (1 - t);
    floatProperties._ShadeShift = x;
    floatProperties._ShadeToony = y;

    if (main.giEqualizationFactor != 0.9) floatProperties._IndirectLightIntensity = main.giEqualizationFactor;

    //if (main.matcapFactor && main.matcapFactor.getHex() != 16777215)
    //    vectorProperties._SphereAddColor = gamma(main.matcapFactor);
    if (main.matcapTexture)
        await addTexture2(main.matcapTexture, '_SphereAdd');

    if (main.rimLightingMixFactor != 1)
        floatProperties._RimLightingMix = main.rimLightingMixFactor;
    if (main.rimMultiplyTexture)
        textureProperties._RimTexture = (await addTexture(state, main.rimMultiplyTexture)).index;
    if (main.parametricRimColorFactor && main.parametricRimColorFactor.getHex() != 0)
        vectorProperties._RimColor = gamma(main.parametricRimColorFactor, 1);
    if (main.parametricRimFresnelPowerFactor != 5)
        floatProperties._RimFresnelPower = main.parametricRimFresnelPowerFactor;
    if (main.parametricRimLiftFactor != 0)
        floatProperties._RimLift = main.parametricRimLiftFactor;

    switch (main.outlineWidthMode) {
        case 'worldCoordinates':
            keywordMap.MTOON_OUTLINE_WIDTH_WORLD = true;
            break;
        case 'screenCoordinates':
            keywordMap.MTOON_OUTLINE_WIDTH_SCREEN = true;
            break;
    }
    floatProperties._OutlineWidthMode = { none: 0, worldCoordinates: 1, screenCoordinates: 2 }[main.outlineWidthMode];
    if (main.outlineWidthFactor != 0)
        floatProperties._OutlineWidth = main.outlineWidthFactor * 100;
    if (main.outlineWidthMultiplyTexture)
        await addTexture2(main.outlineWidthMultiplyTexture, '_OutlineWidthTexture');

    if (main.outlineColorFactor && main.outlineColorFactor.getHex() != 0)
        vectorProperties._OutlineColor = gamma(main.outlineColorFactor, 1);
    if (main.outlineColorMode)
        floatProperties._OutlineColorMode = main.outlineColorMode;
    if (main.outlineLightingMixFactor != 1)
        floatProperties._OutlineLightingMix = main.outlineLightingMixFactor;

    if (main.uvAnimationMaskTexture)
        await addTexture2(main.uvAnimationMaskTexture, '_UvAnimMaskTexture');
    if (main.uvAnimationScrollXSpeedFactor != 0)
        floatProperties._UvAnimScrollX = main.uvAnimationScrollXSpeedFactor;
    if (main.uvAnimationScrollYSpeedFactor != 0)
        floatProperties._UvAnimScrollY = main.uvAnimationScrollYSpeedFactor;
    if (main.uvAnimationRotationSpeedFactor != 0)
        floatProperties._UvAnimRotation = main.uvAnimationRotationSpeedFactor;

    const index = state.materials.length - 1;
    if (!state.extensions.VRM.materialProperties) state.extensions.VRM.materialProperties = [];
    state.extensions.VRM.materialProperties[index] = properties;

    state.materialQueue.push({ renderType, properties, renderOrder });
}

async function makeMaterial(state, primitive) {
    const material = {};
    const main = Array.isArray(primitive.material) ? primitive.material[0] : primitive.material;
    const outline = Array.isArray(primitive.material) ? primitive.material[1] : null;

    if (main.name) material.name = main.name;
    material.extensions = {};
    material.extensions.KHR_materials_unlit = {};

    //material.extras = {};

    const PBR = {};
    material.pbrMetallicRoughness = PBR;
    PBR.baseColorFactor = [main.color.r, main.color.g, main.color.b, main.opacity];
    PBR.metallicFactor = 0;
    PBR.roughnessFactor = 0.9;
    //PBR.metallicRoughnessTexture = await this.addTexture(state, main.***);
    //PBR.extensions = {};
    //PBR.extras = {};
    if (main.map)
        PBR.baseColorTexture = await addTexture(state, main.map);

    if (main.emissiveMap) {
        material.emissiveTexture = await addTexture(state, main.emissiveMap);
    }
    if (main.emissive) {
        if (state.metaVersion == 0) {
            material.emissiveFactor = gamma(main.emissive);
        } else {
            material.emissiveFactor = main.emissive.toArray();
        }
    }

    if (main.normalMap)
        material.normalTexture = await addTexture(state, main.normalMap);
    if (main.occlusionTexture) {
        material.occlusionTexture = await addTexture(state, main.occlusionTexture);
        material.occlusionTexture.strength = 1;
    }

    if (main.transparent == false && main._alphaTest == 0) material.alphaMode = 'OPAQUE';
    if (main.transparent == false && main._alphaTest != 0) {
        material.alphaMode = 'MASK';
        material.alphaCutoff = main._alphaTest;
    }
    if (main.transparent == true) {
        material.alphaMode = 'BLEND';
    }
    if (main.side == 2)
        material.doubleSided = true;

    const index = state.materials.length;
    state.materials.push(material);
    state.materialMap.set(main, index);

    if (state.metaVersion == 1) await makeMToon(state, main, primitive.renderOrder);
    if (state.metaVersion == 0) await makeMaterialProperties(state, main, primitive.renderOrder);

    return index;
}

async function makeMesh(state, targets) {
    const mesh = {};
    mesh.name = targets[0].name;
    mesh.primitives = [];
    for (const target of targets) {
        const primitive = {};
        primitive.attributes = {};
        primitive.name = target.name;

        if (target.geometry.index) primitive.indices = addAccessor(state,
            target.geometry.index.array, 'SCALAR', target.name + '_index', false
        );
        if (target.geometry.attributes?.position) {
            const array = target.geometry.attributes.position.array.slice();
            if (state.metaVersion == 0) {
                for (let i = 0; i < array.length; i += 3) {
                    array[i] = -array[i];
                    array[i + 2] = -array[i + 2];
                }
            }
            primitive.attributes.POSITION = addAccessor(state, array, 'VEC3', target.name + '_position', true);
        }
        if (target.geometry.attributes?.uv) primitive.attributes.TEXCOORD_0 = addAccessor(state,
            target.geometry.attributes.uv.array, 'VEC2', target.name + '_uv', false
        );
        if (target.geometry.attributes?.normal) {
            const array = target.geometry.attributes.normal.array.slice();
            if (state.metaVersion == 0) {
                for (let i = 0; i < array.length; i += 3) {
                    array[i] = -array[i];
                    array[i + 2] = -array[i + 2];
                }
            }
            primitive.attributes.NORMAL = addAccessor(state, array, 'VEC3', target.name + '_normal', true);
        }
        if (target.geometry.attributes?.skinIndex) primitive.attributes.JOINTS_0 = addAccessor(state,
            target.geometry.attributes.skinIndex.array, 'VEC4', target.name + '_joint', false
        );
        if (target.geometry.attributes?.skinWeight) primitive.attributes.WEIGHTS_0 = addAccessor(state,
            target.geometry.attributes.skinWeight.array, 'VEC4', target.name + '_weight', false
        );

        if (target.morphTargetDictionary) {
            const targetNames = [];
            for (const morph in target.morphTargetDictionary) {
                const index = target.morphTargetDictionary[morph];
                const name = target.morphTargetDictionary[morph];
                targetNames[index] = morph;
            }
            primitive.extras = { targetNames: targetNames };

            const positions = target.geometry.morphAttributes.position;
            const normals = target.geometry.morphAttributes.normal;
            primitive.targets = [];
            for (let i = 0; i < positions.length; i++) {
                const item = {};
                if (positions && positions[i]) {
                    const array = positions[i].array.slice();
                    if (state.metaVersion == 0) {
                        for (let i = 0; i < array.length; i += 3) {
                            array[i] = -array[i];
                            array[i + 2] = -array[i + 2];
                        }
                    }
                    item.POSITION = addAccessor(state, array, 'VEC3', targetNames[i] + '_position', true);
                }
                if (normals && normals[i]) {
                    const array = normals[i].array.slice();
                    if (state.metaVersion == 0) {
                        for (let i = 0; i < array.length; i += 3) {
                            array[i] = -array[i];
                            array[i + 2] = -array[i + 2];
                        }
                    }
                    item.NORMAL = addAccessor(state, array, 'VEC3', targetNames[i] + '_normal', false);
                }
                primitive.targets.push(item);
            }
        }
        primitive.material = await makeMaterial(state, target);
        primitive.mode = 4;
        mesh.primitives.push(primitive);
    }
    if (mesh.primitives[0]?.extras?.targetNames) mesh.extras = { targetNames: mesh.primitives[0].extras.targetNames };
    const index = state.meshes.length;
    state.meshes.push(mesh);
    state.meshMap.set(targets[0], index);
    return index;
}
function makeAttribute(state, targets, name, rotate = false) {
    const length = targets.reduce((sum, target) => sum + target.geometry.attributes[name].array.length, 0);
    const array = new targets[0].geometry.attributes[name].array.constructor(length);
    let offset = 0;
    for (let i = 0; i < targets.length; i++) {
        array.set(targets[i].geometry.attributes[name].array, offset);
        offset += targets[i].geometry.attributes[name].array.length;
    }
    if (state.metaVersion == 0 && rotate) {
        for (let i = 0; i < array.length; i += 3) {
            array[i] = -array[i];
            array[i + 2] = -array[i + 2];
        }
    }
    return array;
}
function makeAttributes(state, targets) {
    const name = targets[0].name;

    const POSITION = addAccessor(state, makeAttribute(state, targets, 'position', true), 'VEC3', name + '_position', true);
    const NORMAL = addAccessor(state, makeAttribute(state, targets, 'normal', true), 'VEC3', name + '_normal', true);

    const TEXCOORD_0 = addAccessor(state, makeAttribute(state, targets, 'uv'), 'VEC2', name + '_uv', true);
    const JOINTS_0 = addAccessor(state, makeAttribute(state, targets, 'skinIndex'), 'VEC4', name + '_joint', true);
    const WEIGHTS_0 = addAccessor(state, makeAttribute(state, targets, 'skinWeight'), 'VEC4', name + '_weight', true);
    return { POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0 };
}
function makeMorph(state, primitives) {
    if (!primitives[0].morphTargetDictionary) return null;

    const targetNames = [];
    for (const morphName in primitives[0].morphTargetDictionary) {
        const index = primitives[0].morphTargetDictionary[morphName];
        targetNames[index] = morphName;
    }

    function makeMorpfTarget(state, primitives, name, i) {
        const length = primitives.reduce((sum, target) => sum + target.geometry.morphAttributes[name][0].array.length, 0);
        const array = new primitives[0].geometry.morphAttributes[name][0].array.constructor(length);
        let offset = 0;
        for (let j = 0; j < primitives.length; j++) {
            array.set(primitives[j].geometry.morphAttributes[name][i].array, offset);
            offset += primitives[j].geometry.morphAttributes[name][i].array.length;
        }
        if (state.metaVersion == 0) {
            for (let i = 0; i < array.length; i += 3) {
                array[i] = -array[i];
                array[i + 2] = -array[i + 2];
            }
        }
        return array;
    }
    const targets = [];
    for (let i = 0; i < targetNames.length; i++) {
        const name = targetNames[i];
        const POSITION = addAccessor(state, makeMorpfTarget(state, primitives, 'position', i), 'VEC3', name + '_position', true);
        const NORMAL = addAccessor(state, makeMorpfTarget(state, primitives, 'normal', i), 'VEC3', name + '_normal', true);
        targets.push({ POSITION, NORMAL });
    }
    return { targets, targetNames };
}
async function makeMesh2(state, targets) {
    const mesh = {};
    mesh.name = targets[0].name;
    mesh.primitives = [];

    const attributes = makeAttributes(state, targets);
    const morph = makeMorph(state, targets);
    if (morph) mesh.extras = { targetNames: morph.targetNames };

    let offset = 0;
    for (const target of targets) {
        const primitive = {};
        primitive.attributes = attributes;
        primitive.name = target.name;

        const array = target.geometry.index.array.slice();
        for (let i = 0; i < array.length; i++) array[i] += offset;
        primitive.indices = addAccessor(state, array, 'SCALAR', target.name + '_index', false);
        const length = target.geometry.attributes.position.array.length / 3;
        offset += length;

        primitive.material = await makeMaterial(state, target);
        primitive.mode = 4;
        if (morph) {
            primitive.extras = { targetNames: morph.targetNames };
            primitive.targets = morph.targets;
        }
        mesh.primitives.push(primitive);
    }
    const index = state.meshes.length;
    state.meshes.push(mesh);
    state.meshMap.set(targets[0], index);
    return index;
}

function makeSkin(state, targets) {
    if (!targets[0].skeleton) return null;
    const skin = {};
    skin.name = targets[0].name;
    skin.joints = targets[0].skeleton.bones.map(bone => state.nodeMap.get(bone));
    const matrices = [];
    for (const boneInverse of targets[0].skeleton.boneInverses) {
        const array = boneInverse.toArray().slice();
        if (state.metaVersion == 0) {
            for (let i = 0; i < array.length; i += 16) {
                // Translation
                array[i + 12] = -array[i + 12];
                array[i + 14] = -array[i + 14];
                // Rotation
                array[i + 1] = -array[i + 1];
                array[i + 4] = -array[i + 4];
                array[i + 6] = -array[i + 6];
                array[i + 9] = -array[i + 9];
            }
        }
        matrices.push(...array);
    }
    const array = new Float32Array(matrices);
    skin.inverseBindMatrices = addAccessor(state, array, 'MAT4', skin.name + "_inverse", false, false);
    //skin.extensions = {};
    //skin.extras = {};

    const index = state.skins.length;
    state.skins.push(skin);
    return index;
}

async function findNode(state, node) {
    if (state.org.springBoneManager.colliders.includes(node)) return null;
    if (state.metaVersion == 0 && state.springBoneEnds.has(node)) return null;

    const nodeIndex = state.nodes.length;
    state.nodeMap.set(node, nodeIndex);

    const item = { name: node.name };
    if (state.metaVersion == 1) {
        if (!node.position.equals(state.translationZero)) item.translation = [node.position.x, node.position.y, node.position.z];
        if (!node.quaternion.equals(state.quaternionZero)) item.rotation = [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w];
    } else {
        if (!node.position.equals(state.translationZero)) item.translation = [-node.position.x, node.position.y, -node.position.z];
        if (!node.quaternion.equals(state.quaternionZero)) item.rotation = [-node.quaternion.x, node.quaternion.y, -node.quaternion.z, node.quaternion.w];
    }
    if (!node.scale.equals(state.scaleOne)) item.scale = [node.scale.x, node.scale.y, node.scale.z];
    state.nodes.push(item);

    if (node.isMesh) {
        // Single primitive
        state.makeMeshQueues.push({ item, nodes: [node] });
        state.primitiveMap.set(node, nodeIndex);
        return nodeIndex;
    }
    if (node.children && node.children.length > 0) {
        const f = node.children.findIndex(v => !v.isMesh);
        if (f < 0) {
            // Mesh with primitives
            state.makeMeshQueues.push({ item, nodes: node.children });
            state.primitiveMap.set(node.children[0], nodeIndex);
            return nodeIndex;
        }
    }
    const children = [];
    for (const child of node.children) {
        const childNumber = await findNode(state, child);
        if (childNumber != null) children.push(childNumber);
    }
    if (children.length > 0) item.children = children;
    return nodeIndex;
}

function findSpringBoneRoots(state) {
    state.springBoneRoots = new Map([...state.org.springBoneManager.joints].map(joint => [joint.bone, joint]));
    state.org.springBoneManager.joints.forEach(joint => state.springBoneRoots.delete(joint.child));
}

function findSpringBoneEnds(state) {
    state.springBoneEnds = new Map([...state.org.springBoneManager.joints].map(joint => [joint.child, joint]));
    state.org.springBoneManager.joints.forEach(joint => state.springBoneEnds.delete(joint.bone));
}

async function makeScenes(state) {
    findSpringBoneRoots(state);
    findSpringBoneEnds(state);
    for (const node of state.org.scene.children) {
        if (node.type == 'VRMExpression') break;
        if (node.name == 'VRMHumanoidRig') break;
        const nodeIndex = await findNode(state, node);
        state.scenes[0].nodes.push(nodeIndex);
    }

    for (const makeMeshQueue of state.makeMeshQueues) {
        const nodes = makeMeshQueue.nodes;
        const item = makeMeshQueue.item;
        item.mesh = await makeMesh2(state, nodes);
        const skinIndex = makeSkin(state, nodes);
        if (skinIndex != null) item.skin = skinIndex;
    }
    if (state.metaVersion == 0) {
        const renderTypes=['Opaque', 'TransparentCutout', 'Transparent', 'TransparentWithZWrite'];
        const renderOffsets=[2000, 2450, 3000, 3500];
        renderTypes.forEach((renderType, index) => {
            const materials = state.materialQueue.filter(m => m.renderType === renderType);
            const sortedMaterials = materials.sort((a, b) => a.renderOrder - b.renderOrder);
            sortedMaterials.forEach((material, i) => {
                material.properties.renderQueue = renderOffsets[index] + i;
            });
        });
    }
}

function makeConstraint(state) {
    if (!state.org.nodeConstraintManager) return;
    state.extensionsUsed.push('VRMC_node_constraint');
    const constraints = state.org.nodeConstraintManager._constraints;
    for (const constraint of constraints) {
        const node = state.nodes[state.nodeMap.get(constraint.destination)];
        const source = state.nodeMap.get(constraint.source);
        const target = {};
        node.extensions = { VRMC_node_constraint: { specVersion: "1.0", constraint: target } };
        if (constraint._v3AimAxis) {
            target.aim = {
                aimAxis: constraint._aimAxis,
                source,
                weight: constraint.weight
            };
            continue;
        }
        if (constraint._v3RollAxis) {
            target.roll = {
                rollAxis: constraint._rollAxis,
                source,
                weight: constraint.weight
            };
            continue;
        }
        target.rotation = {
            source,
            weight: constraint.weight
        }
    }
}

function makeSpringBone(state) {
    const springBoneManager = state.org.springBoneManager;
    if (!springBoneManager) return;

    const colliders = [];
    const colliderMap = new Map();

    function makeCollider(collider) {
        const node = state.nodeMap.get(collider.parent);
        const shape = {};
        if (collider.shape.type == 'sphere') {
            const sphere = {};
            if (collider.shape.offset != undefined) sphere.offset = collider.shape.offset.toArray();
            if (collider.shape.radius != undefined) sphere.radius = collider.shape.radius;
            if (collider.shape.inside != undefined) sphere.inside = collider.shape.inside;
            shape.sphere = sphere;
        }
        if (collider.shape.type == 'capsule') {
            const capsule = {};
            if (collider.shape.offset != undefined) capsule.offset = collider.shape.offset.toArray();
            if (collider.shape.radius != undefined) capsule.radius = collider.shape.radius;
            if (collider.shape.tail != undefined) capsule.tail = collider.shape.tail.toArray();
            if (collider.shape.inside != undefined) capsule.inside = collider.shape.inside;
            shape.capsule = capsule;
        }
        if (collider.shape.type == 'plane') {
            const plane = {};
            if (collider.shape.offset != undefined) plane.offset = collider.shape.offset.toArray();
            if (collider.shape.normal != undefined) plane.normal = collider.shape.normal.toArray();
            shape.plane = plane;
        }
        const index = colliders.length;
        colliders.push({ node, shape });
        return index;
    }

    const colliderGroups = [];
    springBoneManager.colliderGroups.forEach(group => {
        const name = group.name;
        const colliders = [];
        for (const collider of group.colliders) {
            if (!colliderMap.has(collider)) {
                const index = makeCollider(collider);
                colliderMap.set(collider, index);
                colliders.push(index);
            } else {
                const index = colliderMap.get(collider);
                colliders.push(index);
            }
        }
        //const colliders = group.colliders.map(v => springBoneManager.colliders.indexOf(v));
        colliderGroups.push({ name, colliders });
    });

    const jointMap = new Map();
    springBoneManager.joints.forEach(joint => jointMap.set(joint.bone, joint));

    const springs = [];
    state.springBoneRoots.forEach((joint) => {
        const spring = { name: joint.bone.name };
        spring.center = state.nodeMap.get(joint.center);
        spring.colliderGroups = joint.colliderGroups.map(v => springBoneManager.colliderGroups.indexOf(v));;
        const joints = [];
        let lastJoint;
        let j = joint;
        while (j) {
            const joint = { node: state.nodeMap.get(j.bone) };
            if (j.settings.dragForce) joint.dragForce = j.settings.dragForce;
            if (j.settings.gravityDir) joint.gravityDir = j.settings.gravityDir.toArray();
            if (j.settings.gravityPower) joint.gravityPower = j.settings.gravityPower;
            if (j.settings.hitRadius) joint.hitRadius = j.settings.hitRadius;
            if (j.settings.stiffness) joint.stiffness = j.settings.stiffness;
            joints.push(joint);
            lastJoint = j;
            j = jointMap.get(j.child);
        }
        joints.push({ node: state.nodeMap.get(lastJoint.child) });
        spring.joints = joints;
        springs.push(spring);
    });

    state.extensions.VRMC_springBone = { specVersion: "1.0", colliderGroups, colliders, springs };
    if (!state.extensionsUsed.includes('VRMC_springBone')) state.extensionsUsed.push('VRMC_springBone');
}

function makeSecondaryAnimation(state) {
    const springBoneManager = state.org.springBoneManager;
    if (!springBoneManager) return;

    const newColliderGroups = [];
    const colliderGroupMap = new Map();
    const boneGroupMap = new Map();
    state.springBoneRoots.forEach((joint) => {
        const boneGroup = {};
        boneGroup.center = state.nodeMap.get(joint._center);
        boneGroup.dragForce = joint.settings.dragForce;
        boneGroup.gravityDir = { ...joint.settings.gravityDir };
        boneGroup.gravityDir.x = -boneGroup.gravityDir.x;
        boneGroup.gravityDir.z = -boneGroup.gravityDir.z;
        boneGroup.gravityPower = joint.settings.gravityPower;
        boneGroup.hitRadius = joint.settings.hitRadius;
        boneGroup.stiffiness = joint.settings.stiffness;
        boneGroup.colliderGroups = [];

        const colliderMap = new Map();
        joint.colliderGroups.forEach(colliderGroup => {
            colliderGroup.colliders.forEach(collider => {
                const key = collider.parent;
                if (!colliderMap.has(key)) colliderMap.set(key, []);
                colliderMap.get(key).push(collider);
            });
        });
        colliderMap.forEach((colliderRef, bone) => {
            const node = state.nodeMap.get(bone);
            const colliders = [];
            colliderRef.forEach(collider => {
                const offset = collider.shape.offset;
                const radius = collider.shape.radius;
                const newColider = { offset, radius };
                colliders.push(newColider);
            });
            const colliderGroup = { node, colliders };
            const key = JSON.stringify(colliderGroup);
            if (!colliderGroupMap.has(key)) {
                colliderGroupMap.set(key, newColliderGroups.length);
                newColliderGroups.push(colliderGroup);
            }
            boneGroup.colliderGroups.push(colliderGroupMap.get(key));
        });
        const key = JSON.stringify(boneGroup);
        if (!boneGroupMap.has(key)) boneGroupMap.set(key, []);
        boneGroupMap.get(key).push(state.nodeMap.get(joint.bone));
    });

    const colliderGroups = [];
    newColliderGroups.forEach(colliderGroup => {
        colliderGroup.colliders.forEach(collider => {
            collider.offset = { ...collider.offset };
            collider.offset.x = -collider.offset.x;
        });
        colliderGroups.push(colliderGroup);
    })

    const boneGroups = [];
    boneGroupMap.forEach((bones, key) => {
        const boneGroup = JSON.parse(key);
        boneGroup.bones = bones;
        boneGroups.push(boneGroup)
    });

    state.extensions.VRM.secondaryAnimation = { boneGroups, colliderGroups };
    return;
}

function makeExpressions(state) {
    const expressions = {};
    const expressionMap = state.org.expressionManager._expressionMap;
    expressions.preset = {};
    for (const name in expressionMap) {
        const morphTargetBinds = [];
        const materialColorBinds = [];
        const textureTransformBinds = [];
        const nodeCheck = {};
        for (const bind of expressionMap[name]._binds) {
            if (bind.primitives) {
                for (const primitive of bind.primitives) {
                    const node = state.nodeMap.get(primitive.parent);
                    if (!nodeCheck[node]) {
                        const index = bind.index;
                        const weight = bind.weight;
                        morphTargetBinds.push({ index, node, weight });
                        nodeCheck[node] = true;
                    }
                }
            }
            if (bind.material) {
                const material = state.materialMap[bind.material];
                if (bind.offset || bind.scale) {
                    const scale = bind.scale.toArray();
                    const offset = bind.offset.toArray();
                    textureTransformBinds.push({ material, scale, offset });
                } else {
                    //materialColorBinds.push({ material, type, targetValue });
                }
            }
        }
        expressions.preset[name] = {
            isBinary: expressionMap[name].isBinary,
            //morphTargetBinds: morphTargetBinds,
            overrideBlink: expressionMap[name].overrideBlink,
            overrideLookAt: expressionMap[name].overrideLookAt,
            overrideMouth: expressionMap[name].overrideMouth
        };
        if (morphTargetBinds.length > 0) expressions.preset[name].morphTargetBinds = morphTargetBinds;
        if (textureTransformBinds.length > 0) expressions.preset[name].textureTransformBinds = textureTransformBinds;
        if (materialColorBinds.length > 0) expressions.preset[name].materialColorBinds = materialColorBinds;
    }
    state.extensions.VRMC_vrm.expressions = expressions;
}

function makeFirstPerson(state) {
    const meshAnnotations = state.org.firstPerson.meshAnnotations;

    function type2Flag(type) {
        if (type === "firstPersonOnly") {
            return "FirstPersonOnly";
        } else if (type === "thirdPersonOnly") {
            return "ThirdPersonOnly";
        } else if (type === "both") {
            return "Both";
        } else {
            return "Auto";
        }
    }

    const newMeshAnnotations = [];
    if (state.metaVersion == 0) {
        for (const item of Object.values(meshAnnotations)) {
            newMeshAnnotations.push({ mesh: state.primitiveMap.get(item.meshes[0]), firstPersonFlag: type2Flag(item.type) });
        }
    } else {
        const newMeshAnnotations = [];
        for (const item of Object.values(meshAnnotations)) {
            newMeshAnnotations.push({ node: state.primitiveMap.get(item.meshes[0]), type: item.type });
        }
    }
    if (!state.extensions.VRMC_vrm.firstPerson) state.extensions.VRMC_vrm.firstPerson = {};
    if (newMeshAnnotations.length > 0) state.extensions.VRMC_vrm.firstPerson.meshAnnotations = newMeshAnnotations;
}

function makeHumanoid(state) {
    const bones = {}
    const orgBones = state.org.humanoid.humanBones;
    for (const bone in state.org.humanoid.humanBones) {
        const node = state.nodeMap.get(orgBones[bone].node);
        if (node != undefined) bones[bone] = { node };
    }
    state.extensions.VRMC_vrm.humanoid = { humanBones: bones };
}

function makeHumanoid0(state) {
    const humanoid = {
        armStretch: 0.05,
        feetSpacing: 0,
        hasTranslationDoF: false,
        humanBones: [],
        legStretch: 0.05,
        lowerArmTwist: 0.5,
        lowerLegTwist: 0.5,
        upperArmTwist: 0.5,
        upperLegTwist: 0.5
    };
    const bones = state.org.humanoid._rawHumanBones.humanBones;
    const list = {
        leftThumbMetacarpal: 'leftThumbProximal',
        leftThumbProximal: 'leftThumbIntermediate',
        rightThumbMetacarpal: 'rightThumbProximal',
        rightThumbProximal: 'rightThumbIntermediate',
    };
    for (const boneName in bones) {
        const node = state.nodeMap.get(bones[boneName].node);
        const bone = list[boneName] ? list[boneName] : boneName;
        if (node != undefined) humanoid.humanBones.push({ bone, node, useDefaultValues: true });
    }
    state.extensions.VRM.humanoid = humanoid;
}

function makeLookAt(state) {
    const orgLookAt = state.org.lookAt;
    if (state.metaVersion == 0) {
        if (!state.extensions.VRM.firstPerson) state.extensions.VRM.firstPerson = {};
        const lookAt = state.extensions.VRM.firstPerson;

        lookAt.firstPersonBone = state.extensions.VRM.humanoid.humanBones.find(v => v.bone == 'head').node;
        lookAt.firstPersonBoneOffset = orgLookAt.offsetFromHeadBone;
        lookAt.firstPersonBoneOffset.x = -lookAt.firstPersonBoneOffset.x;
        lookAt.firstPersonBoneOffset.z = -lookAt.firstPersonBoneOffset.z;

        if (orgLookAt.applier.humanoid) lookAt.lookAtTypeName = 'Bone';
        if (orgLookAt.applier.expressions) lookAt.lookAtTypeName = 'BlendShape';

        function degreeMap(rangeMap) {
            const xRange = rangeMap.inputMaxValue;
            const yRange = rangeMap.outputScale;
            const curve = [0, 0, 0, 1, 1, 1, 1, 0];
            const degreemap = { xRange, yRange, curve };
            return degreemap;
        }
        lookAt.lookAtHorizontalInner = degreeMap(orgLookAt.applier.rangeMapHorizontalInner);
        lookAt.lookAtHorizontalOuter = degreeMap(orgLookAt.applier.rangeMapHorizontalOuter);
        lookAt.lookAtVerticalDown = degreeMap(orgLookAt.applier.rangeMapVerticalDown);
        lookAt.lookAtVerticalUp = degreeMap(orgLookAt.applier.rangeMapVerticalUp);

        //state.extensions.VRM.firstPerson = lookAt;
    } else {
        const lookAt = {};
        lookAt.offsetFromHeadBone = orgLookAt.offsetFromHeadBone.toArray();

        lookAt.rangeMapHorizontalInner = orgLookAt.applier.rangeMapHorizontalInner;
        lookAt.rangeMapHorizontalOuter = orgLookAt.applier.rangeMapHorizontalOuter;
        lookAt.rangeMapVerticalDown = orgLookAt.applier.rangeMapVerticalDown;
        lookAt.rangeMapVerticalUp = orgLookAt.applier.rangeMapVerticalUp;

        if (orgLookAt.applier.humanoid) lookAt.type = 'bone';
        if (orgLookAt.applier.expressions) lookAt.type = 'expression';

        state.extensions.VRMC_vrm.lookAt = lookAt;
    }
}

async function makeMeta1(state) {
    const meta = {};
    const orgMeta = state.org.meta;
    for (const key of [
        'name',
        'authors',
        'copyrightInformation',
        'references',
        'thirdPartyLicenses',
        'licenseUrl',
        'avatarPermission',
        'allowExcessivelyViolentUsage',
        'allowExcessivelySexualUsage',
        'commercialUsage',
        'allowPoliticalOrReligiousUsage',
        'allowAntisocialOrHateUsage',
        'creditNotation',
        'allowRedistribution',
        'modification',
        'version',
        'contactInformation',
        'otherLicenseUrl'
    ]) if (orgMeta[key] !== undefined) meta[key] = orgMeta[key];
    if (meta.licenseUrl == undefined || meta.licenseUrl == '') meta.licenseUrl = "https://vrm.dev/licenses/1.0/";
    if (orgMeta.thumbnailImage !== undefined && orgMeta.thumbnailImage !== null) {
        meta.thumbnailImage = await addImage(state, orgMeta.thumbnailImage, 'Thumbnail', false);
    }
    state.extensions.VRMC_vrm.meta = meta;
}

async function makeMeta0(state) {
    const meta = state.org.meta;
    const newMeta = {};

    if (meta.name) newMeta.title = meta.name;
    if (meta.version) newMeta.version = meta.version;

    if (meta.authors) newMeta.author = meta.authors.join(', ');
    if (meta.contactInformation) newMeta.contactInformation = meta.contactInformation;
    if (meta.references) {
        newMeta.reference = meta.references.join(', ');
    } else {
        newMeta.reference = '';
    }

    if (meta.thumbnailImage !== undefined && meta.thumbnailImage !== null) {
        const texture = new THREE.Texture(meta.thumbnailImage);
        texture.name = 'Thumbnail';
        texture.flipY = false;
        const index = await addTexture(state, texture);
        newMeta.texture = index.index;
    }

    switch (meta.avatarPermission) {
        case 'everyone': newMeta.allowedUserName = "Everyone"; break;
        case 'onlySeparatelyLicensedPerson': newMeta.allowedUserName = "ExplicitlyLicensedPerson"; break;
        case 'onlyAuthor':
        default: newMeta.allowedUserName = "OnlyAuthor";
    }
    if (meta.allowExcessivelyViolentUsage == true) {
        newMeta.violentUssageName = 'Allow';
    } else {
        newMeta.violentUssageName = 'Disallow';
    }
    if (meta.allowExcessivelySexualUsage == true) {
        newMeta.sexualUssageName = 'Allow';
    } else {
        newMeta.sexualUssageName = 'Disallow';
    }
    switch (meta.commercialUsage) {
        case 'corporation': newMeta.commercialUssageName = "Allow"; break;
        case 'personalProfit':
        case 'personalNonProfit':
        default: newMeta.commercialUssageName = "Disallow";
    }

    newMeta.otherPermissionUrl = '';
    newMeta.licenseName = '';
    const l = {};
    if (meta.allowRedistribution) l.d = true;
    if (meta.modification == 'allowModificationRedistribution') l.m = true;
    if (meta.commercialUsage == 'corporation') l.c = true;
    if (meta.creditNotation == 'unnecessary') l.n = true;

    newMeta.licenseName = 'Redistribution_Prohibited';
    if (l.d) newMeta.licenseName = 'CC_BY_NC_ND';
    if (l.d && l.c) newMeta.licenseName = 'CC_BY_ND';
    if (l.d && l.m) newMeta.licenseName = 'CC_BY_NC_SA';
    if (l.d && l.m && l.c) newMeta.licenseName = 'CC_BY_SA';
    if (l.d && l.m && l.n) newMeta.licenseName = 'CC_BY_NC';
    if (l.d && l.m && l.c && l.n) newMeta.licenseName = 'CC_BY';
    if (l.d && l.m && l.c && l.n) newMeta.licenseName = 'CC0';

    newMeta.otherLicenseUrl = meta.otherLicenseUrl ?? '';
    state.extensions.VRM.meta = newMeta;
}

function makeBlendShapeMaster(state) {
    const presetNames = {
        neutral: ['Neutral', 'neutral'],
        aa: ['A', 'a'],
        ee: ['E', 'e'],
        ih: ['I', 'i'],
        oh: ['O', 'o'],
        ou: ['U', 'u'],
        blink: ['Blink', 'blink'],
        happy: ['Joy', 'joy'],
        angry: ['Angry', 'angry'],
        sad: ['Sorrow', 'sorrow'],
        relaxed: ['Fun', 'fun'],
        lookUp: ['LookUp', 'lookup'],
        lookDown: ['LookDown', 'lookdown'],
        lookLeft: ['LookLeft', 'lookleft'],
        lookRight: ['LookRight', 'lookright'],
        blinkLeft: ['Blink_L', 'blink_l'],
        blinkRight: ['Blink_R', 'blink_r'],
        surprised: ['Surprised', 'unknown']
    };

    const expressions = state.org.expressionManager._expressions;
    const blendShapeGroups = [];
    expressions.forEach(expression => {
        const presetName = presetNames[expression.expressionName];
        let blendShapeGroup = {};
        if (presetName) {
            blendShapeGroup = { name: presetName[0], presetName: presetName[1] };
        } else {
            blendShapeGroup = { name: expression.expressionName, presetName: 'unknown' };
        }
        blendShapeGroup.isBinary = expression.isBinary;
        blendShapeGroup.binds = [];
        for (const bind of expression._binds) {
            if (bind.primitives) {
                const mesh = state.meshMap.get(bind.primitives[0]);
                const index = bind.index;
                const weight = bind.weight * 100;
                blendShapeGroup.binds.push({ mesh, index, weight });
            }
            if (bind.material) {
                console.log('Expression bindMaterial not yet supported: ' + bind);
            }
        }
        blendShapeGroup.materialValues = [];
        blendShapeGroups.push(blendShapeGroup);
    });
    state.extensions.VRM.blendShapeMaster = { blendShapeGroups };
}

async function makeVRM(state) {
    if (state.metaVersion == 1) {
        if (!state.extensionsUsed.includes('VRMC_vrm')) state.extensionsUsed.push('VRMC_vrm');
        makeExpressions(state);
        makeFirstPerson(state);
        makeHumanoid(state);
        makeLookAt(state);
        await makeMeta1(state);
        makeSpringBone(state);
        makeConstraint(state);
    } else {
        if (!state.extensionsUsed.includes('VRM')) state.extensionsUsed.push('VRM');
        await makeMeta0(state);
        makeHumanoid0(state);
        makeBlendShapeMaster(state);
        state.extensions.VRM.exporterVersion = "VRMExporterByRingo0.0";
        makeLookAt(state);
        makeFirstPerson(state);
        makeSecondaryAnimation(state);
    }
}

function makeGlb(state) {
    state.buffer = new Uint8Array(state.offset);
    for (let i = 0; i < state.bufferViews.length; i++) {
        state.buffer.set(new Uint8Array(state.buffers[i].buffer), state.bufferViews[i].byteOffset);
    }

    const s = state;
    const j = {};
    j.asset = s.asset;
    j.accessors = s.accessors;
    j.bufferViews = s.bufferViews;
    j.buffers = [{ byteLength: state.buffer.byteLength }];
    j.extensions = {};
    if (state.metaVersion == 0) {
        j.extensions.VRM = s.extensions.VRM;
    } else {
        j.extensions.VRMC_vrm = s.extensions.VRMC_vrm;
        j.extensions.VRMC_springBone = s.extensions.VRMC_springBone;
    }
    j.extensionsUsed = s.extensionsUsed;
    j.images = s.images;
    j.materials = s.materials;
    j.meshes = s.meshes;
    j.nodes = s.nodes;
    j.samplers = s.samplers;
    j.scene = s.scene;
    j.scenes = s.scenes;
    j.skins = s.skins;
    j.textures = s.textures;

    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(JSON.stringify(j));

    const jsonBuffer = new Uint8Array(align4(jsonBytes.length));
    jsonBuffer.set(jsonBytes);
    jsonBuffer.fill(0x20, jsonBytes.length);
    const jsonChunkData = jsonBuffer.buffer;
    const binChunkData = state.buffer.buffer;
    const glb = bindBuffers({ jsonChunkData, binChunkData });
    return glb;
}

export async function VRMExport(originalVrm, metaVersion = 1) {
    const state = {};
    state.org = originalVrm;
    state.metaVersion = metaVersion;
    init(state);

    await makeScenes(state);
    await makeVRM(state, metaVersion);
    const glb = makeGlb(state);
    return glb;
}

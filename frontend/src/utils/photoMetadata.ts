export interface TrialPhotoMetadata {
  xmpDroneDjiImageSource: string | null;
  ifd0ImageDescription: string | null;
  thermalImagingAvailable: boolean;
}

const THERMAL_IMAGE_SOURCE = "InfraredCamera";
const THERMAL_IMAGE_DESCRIPTION = "IronRed";
const XMP_SCAN_LIMIT = 3_000_000;

export async function readTrialPhotoMetadata(file: File): Promise<TrialPhotoMetadata> {
  const buffer = await file.arrayBuffer();
  const xmpDroneDjiImageSource = findXmpImageSource(buffer);
  const ifd0ImageDescription = findIfd0ImageDescription(buffer) ?? findTextValue(buffer, [
    "IFD0-ImageDescription",
    "ImageDescription"
  ]);

  return {
    xmpDroneDjiImageSource,
    ifd0ImageDescription,
    thermalImagingAvailable: isThermalImagingAvailable(
      xmpDroneDjiImageSource,
      ifd0ImageDescription
    )
  };
}

function isThermalImagingAvailable(imageSource: string | null, imageDescription: string | null) {
  return normalize(imageSource) === THERMAL_IMAGE_SOURCE
    && normalize(imageDescription) === THERMAL_IMAGE_DESCRIPTION;
}

function normalize(value: string | null) {
  return (value ?? "").replace(/\0/g, "").trim();
}

function findXmpImageSource(buffer: ArrayBuffer) {
  return findTextValue(buffer, [
    "XMP-drone-dji-ImageSource",
    "drone-dji:ImageSource"
  ]);
}

function findTextValue(buffer: ArrayBuffer, keys: string[]) {
  const length = Math.min(buffer.byteLength, XMP_SCAN_LIMIT);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(
    new Uint8Array(buffer, 0, length)
  );

  for (const key of keys) {
    const escapedKey = escapeRegExp(key);
    const attributeMatch = text.match(new RegExp(`${escapedKey}\\s*=\\s*["']([^"']+)["']`, "i"));
    if (attributeMatch?.[1]) return normalize(attributeMatch[1]);

    const assignmentMatch = text.match(new RegExp(`${escapedKey}\\s*[:=]\\s*["']?([^"'<>\\r\\n]+)`, "i"));
    if (assignmentMatch?.[1]) return normalize(assignmentMatch[1]);

    const elementKey = key.includes(":") ? key : `[^:<>]*:?${escapedKey}`;
    const elementMatch = text.match(new RegExp(`<${elementKey}[^>]*>([^<]+)</${elementKey}>`, "i"));
    if (elementMatch?.[1]) return normalize(elementMatch[1]);
  }

  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findIfd0ImageDescription(buffer: ArrayBuffer) {
  const data = new DataView(buffer);
  const tiffStart = findTiffStart(data);
  if (tiffStart === null || tiffStart + 8 > data.byteLength) return null;

  const littleEndian = getByte(data, tiffStart) === 0x49 && getByte(data, tiffStart + 1) === 0x49;
  const bigEndian = getByte(data, tiffStart) === 0x4d && getByte(data, tiffStart + 1) === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  if (data.getUint16(tiffStart + 2, littleEndian) !== 0x2a) return null;

  const firstIfdOffset = data.getUint32(tiffStart + 4, littleEndian);
  const ifdStart = tiffStart + firstIfdOffset;
  if (ifdStart + 2 > data.byteLength) return null;

  const entryCount = data.getUint16(ifdStart, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryStart = ifdStart + 2 + (index * 12);
    if (entryStart + 12 > data.byteLength) return null;
    const tag = data.getUint16(entryStart, littleEndian);
    if (tag !== 0x010e) continue;

    const type = data.getUint16(entryStart + 2, littleEndian);
    const count = data.getUint32(entryStart + 4, littleEndian);
    const typeSize = tiffTypeSize(type);
    if (!typeSize || count <= 0) return null;

    const byteLength = count * typeSize;
    const valueStart = byteLength <= 4
      ? entryStart + 8
      : tiffStart + data.getUint32(entryStart + 8, littleEndian);
    if (valueStart < 0 || valueStart >= data.byteLength) return null;

    const valueLength = Math.min(byteLength, data.byteLength - valueStart);
    const value = new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(buffer, valueStart, valueLength)
    );
    return normalize(value);
  }

  return null;
}

function findTiffStart(data: DataView) {
  if (data.byteLength >= 4) {
    const first = getByte(data, 0);
    const second = getByte(data, 1);
    if ((first === 0x49 && second === 0x49) || (first === 0x4d && second === 0x4d)) return 0;
  }

  if (data.byteLength < 4 || getByte(data, 0) !== 0xff || getByte(data, 1) !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= data.byteLength) {
    if (getByte(data, offset) !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = getByte(data, offset + 1);
    if (marker === 0xda || marker === 0xd9) break;

    const segmentLength = data.getUint16(offset + 2, false);
    if (segmentLength < 2) return null;
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentEnd > data.byteLength) return null;

    if (
      marker === 0xe1
      && segmentStart + 6 <= segmentEnd
      && getAscii(data, segmentStart, 6) === "Exif\0\0"
    ) {
      return segmentStart + 6;
    }

    offset = segmentEnd;
  }

  return null;
}

function getByte(data: DataView, offset: number) {
  return data.getUint8(offset);
}

function getAscii(data: DataView, offset: number, length: number) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(data.getUint8(offset + index));
  }
  return value;
}

function tiffTypeSize(type: number) {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return 0;
  }
}

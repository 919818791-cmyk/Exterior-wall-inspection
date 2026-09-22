export type PhotoVariant = "visible" | "thermal";

export interface VisibleThermalPair<T> {
  key: string;
  visible: T | null;
  thermal: T | null;
}

interface PairVisibleThermalPhotosOptions<T> {
  filename: (item: T) => string | null | undefined;
  isThermal: (item: T) => boolean;
  itemKey: (item: T) => string;
}

export function photoVariantFromFilename(
  filename: string | null | undefined
): PhotoVariant | null {
  const match = filename?.trim().match(/_([vt])(?:\.[^.]+)$/i);
  if (!match) return null;
  return match[1].toLocaleLowerCase() === "t" ? "thermal" : "visible";
}

export function photoPairKey(filename: string | null | undefined) {
  const match = filename?.trim().match(/^(.*)_([vt])(?:\.[^.]+)$/i);
  return match ? match[1].toLocaleLowerCase() : null;
}

export function pairVisibleThermalPhotos<T>(
  items: T[],
  options: PairVisibleThermalPhotosOptions<T>
): VisibleThermalPair<T>[] {
  const consumedIndexes = new Set<number>();
  const pairs: VisibleThermalPair<T>[] = [];

  items.forEach((item, index) => {
    if (consumedIndexes.has(index)) return;
    consumedIndexes.add(index);

    const filename = options.filename(item);
    const namedVariant = photoVariantFromFilename(filename);
    const pairKey = photoPairKey(filename);
    let matchedIndex = -1;
    if (namedVariant && pairKey) {
      matchedIndex = items.findIndex((candidate, candidateIndex) => (
        candidateIndex !== index
        && !consumedIndexes.has(candidateIndex)
        && photoPairKey(options.filename(candidate)) === pairKey
        && photoVariantFromFilename(options.filename(candidate)) !== namedVariant
      ));
    }

    const matchedItem = matchedIndex >= 0 ? items[matchedIndex] : null;
    if (matchedIndex >= 0) consumedIndexes.add(matchedIndex);
    const itemVariant = namedVariant ?? (options.isThermal(item) ? "thermal" : "visible");

    pairs.push({
      key: matchedItem
        ? `pair:${pairKey}:${options.itemKey(item)}`
        : `unmatched:${options.itemKey(item)}`,
      visible: itemVariant === "visible" ? item : matchedItem,
      thermal: itemVariant === "thermal" ? item : matchedItem
    });
  });

  return pairs;
}

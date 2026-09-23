/**
 * Pure helpers for extracting image files from clipboard, file input, and drag-and-drop events.
 */

/**
 * Extract image files from clipboard data transfer items.
 */
export function extractImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  const items = Array.from(clipboardData?.items ?? []);
  return items
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

/**
 * Extract image files from a FileList (e.g. from an <input type="file"> change event).
 */
export function extractImageFilesFromFileList(fileList: FileList | null): File[] {
  return Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'));
}

/**
 * Extract image files from drag-and-drop DataTransfer files.
 */
export function extractImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  return Array.from(dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

/**
 * Check whether drag-and-drop DataTransfer items contain at least one image.
 */
export function hasImageItems(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.items ?? []).some((item) => item.type.startsWith('image/'));
}

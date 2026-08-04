export function uploadedPosterStorageKey(
  videoId: string,
  objectId: string,
  extension: string
) {
  return `images/${videoId}/${objectId}.${extension}`;
}

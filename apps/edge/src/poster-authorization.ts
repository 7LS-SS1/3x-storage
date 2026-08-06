export const PERMANENT_POSTER_PURPOSE = "poster";

export function permanentPosterSignedValue(input: {
  path: string;
  videoId: string;
  fileId: string;
}) {
  return ["poster_v1", input.path, input.videoId, input.fileId].join("\n");
}

export function isPermanentPosterPath(path: string) {
  return path.startsWith("images/") && /\.(?:jpe?g|png|webp)$/i.test(path);
}

export function isPermanentPosterContentType(contentType: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(contentType.toLowerCase());
}

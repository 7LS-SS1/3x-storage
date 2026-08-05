export type VideoExportRow = {
  title: string;
  category: string;
  embedUrl: string;
  thumbnailUrl: string;
};

export function iframeForVideo(embedUrl: string) {
  return `<iframe src="${embedUrl}" width="100%" height="100%" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
}

function csvCell(value: string) {
  const formulaSafe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

export function createVideosCsv(videos: VideoExportRow[]) {
  const rows = videos.map(video =>
    [
      csvCell(video.title),
      csvCell(video.category),
      csvCell(iframeForVideo(video.embedUrl)),
      csvCell(video.thumbnailUrl)
    ].join(",")
  );
  return `\uFEFFtitle,หมวดหมู่,videos url,url images\r\n${rows.join("\r\n")}${rows.length ? "\r\n" : ""}`;
}

export function downloadVideosCsv(videos: VideoExportRow[], filename: string) {
  const blob = new Blob([createVideosCsv(videos)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

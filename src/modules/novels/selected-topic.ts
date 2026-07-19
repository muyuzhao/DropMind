export type SelectedTopicFields = {
  title: string;
  summary: string;
};

type TopicMarker = {
  kind: "title" | "summary";
  start: number;
  end: number;
};

const TOPIC_MARKER_PATTERN = /(?:^|\n)\s*(?:【\s*(?:参考)?(书名|简介)\s*】|(?:参考)?(书名|简介)\s*[：:])\s*/g;

function findMarkers(value: string): TopicMarker[] {
  const markers: TopicMarker[] = [];
  for (const match of value.matchAll(TOPIC_MARKER_PATTERN)) {
    const label = match[1] ?? match[2];
    markers.push({
      kind: label === "书名" ? "title" : "summary",
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return markers;
}

export function parseSelectedTopic(value: string): SelectedTopicFields {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { title: "", summary: "" };

  const markers = findMarkers(normalized);
  if (markers.length > 0) {
    let title = "";
    let summary = "";

    markers.forEach((marker, index) => {
      const next = markers[index + 1];
      const content = normalized.slice(marker.end, next?.start ?? normalized.length).trim();
      if (marker.kind === "title" && !title) title = content;
      if (marker.kind === "summary" && !summary) summary = content;
    });

    const prefix = normalized.slice(0, markers[0].start).trim();
    if (prefix) summary = summary ? `${prefix}\n\n${summary}` : prefix;
    return { title, summary };
  }

  const lines = normalized.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim());
  if (firstContentLine < 0) return { title: "", summary: "" };

  return {
    title: lines[firstContentLine].trim(),
    summary: lines.slice(firstContentLine + 1).join("\n").trim(),
  };
}

export function formatSelectedTopic(fields: SelectedTopicFields) {
  const title = fields.title.trim();
  const summary = fields.summary.trim();
  if (!title && !summary) return "";
  if (!title) return `【简介】\n${summary}`;
  if (!summary) return `【书名】\n${title}`;
  return `【书名】\n${title}\n\n【简介】\n${summary}`;
}

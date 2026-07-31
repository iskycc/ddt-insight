const graphemeSegmenter = new Intl.Segmenter("zh-CN", {
  granularity: "grapheme",
});

export function displayInitial(value: string) {
  for (const { segment } of graphemeSegmenter.segment(value.trim())) {
    return segment.toLocaleUpperCase("zh-CN");
  }
  return "?";
}

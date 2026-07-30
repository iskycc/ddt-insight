const requiredMajor = 24;
const currentMajor = Number.parseInt(process.versions.node.split(".")[0], 10);

if (currentMajor !== requiredMajor) {
  console.error(
    `DDT Insight 需要 Node.js ${requiredMajor}.x LTS，当前版本为 ${process.version}。`,
  );
  process.exit(1);
}

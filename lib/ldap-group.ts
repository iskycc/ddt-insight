export function ldapGroupLabel(group: string) {
  const firstDnValue = /^[a-z][a-z0-9-]*=((?:\\.|[^,])*)/i.exec(group)?.[1];
  return (
    firstDnValue
      ?.replace(/\\([,=+<>#;"\\])/g, "$1")
      .replace(/^"(.*)"$/, "$1")
      .trim() || group
  );
}

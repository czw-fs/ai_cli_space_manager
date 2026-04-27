export function commandTemplateForApplication(applicationPath: string) {
  return `"${applicationPath.replace(/"/g, "\\\"")}"`;
}

export function nameFromApplicationPath(applicationPath: string) {
  const normalized = applicationPath.replace(/[\\/]+$/, "");
  const fileName = normalized.split(/[\\/]/).filter(Boolean).pop() || normalized || applicationPath;
  return fileName.replace(/\.(exe|lnk)$/i, "") || fileName;
}

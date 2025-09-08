export function generateSafeKey(fileName, index) {
    const baseFileName = fileName.replace(/\.[^/.]+$/, "");
    const safeFileName = baseFileName.replace(/[^a-zA-Z0-9_=-]/g, "-");
    return `${safeFileName}-${index}`;
}
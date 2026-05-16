import fs from 'fs/promises';
import path from 'path';

// Safety: agent can only touch files inside an allowed project root
// Set this to your ESP project base directory
const ALLOWED_ROOT = process.env.PROJECT_ROOT || '/home/student/esp';

function assertSafe(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(ALLOWED_ROOT))) {
    throw new Error(`Access denied: ${filePath} is outside the allowed project root.`);
  }
  return resolved;
}

export async function readFile(filePath) {
  const safe = assertSafe(filePath);
  try {
    return await fs.readFile(safe, 'utf-8');
  } catch (err) {
    return `Error reading file: ${err.message}`;
  }
}

export async function writeFile(filePath, content) {
  const safe = assertSafe(filePath);
  await fs.mkdir(path.dirname(safe), { recursive: true });
  await fs.writeFile(safe, content, 'utf-8');
}

export async function applyFix(filePath, newContent) {
  // Same as writeFile but called from the human-approval path
  return writeFile(filePath, newContent);
}

export async function listFiles(directory) {
  const safe = assertSafe(directory);
  try {
    const entries = await fs.readdir(safe, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      path: path.join(directory, e.name),
    }));
  } catch (err) {
    return `Error listing directory: ${err.message}`;
  }
}

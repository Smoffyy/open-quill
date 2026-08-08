// Public surface of the per-chat file sandbox. Implementation lives in sandbox/:
//   paths   - workspace root resolution and the escape guard
//   meta    - per-file versions, history snapshots, persisted shell cwd
//   ignore  - text detection plus dependency/build and .gitignore filtering
//   files   - the versioned workspace filesystem (read, write, edit, list, search, zip)
//   zip     - the zip codec, pure and filesystem-free
//   hostenv - what is actually installed on this host
//   shell   - bash execution inside the workspace
//   exec    - the model-facing tool dispatch table
export { SANDBOX_ROOT, dirFor } from './sandbox/paths.js';
export { versionOf, listVersions, readVersion } from './sandbox/meta.js';
export { extOf, isText, IGNORED_DIRS, isIgnoredDir, isIgnoredRel, isIgnoredPath } from './sandbox/ignore.js';
export {
  list, dirSize, remove, clearAll, readText, readBuffer, createFile, strReplace,
  insertLines, view, deleteFile, renameFile, copyFile, makeDir, search, findFiles,
  bundleZip, zipAll, extractZip, importBuffer
} from './sandbox/files.js';
export { zipBuffer } from './sandbox/zip.js';
export { hostEnvInfo } from './sandbox/hostenv.js';
export { bash, winTranslate } from './sandbox/shell.js';
export { execTool, unknownToolError } from './sandbox/exec.js';
export { screenCommand, normalizeRel } from './lib/sandboxguard.js';

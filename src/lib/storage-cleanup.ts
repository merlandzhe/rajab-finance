// A failed metadata write must not leave an unreferenced file in Storage.
// A deletion is allowed only after an explicit authoritative "not found" result.
// Database read errors fail closed: never remove a possibly registered document.
export async function cleanupUnregisteredFile(
  lookupRegistration: () => Promise<boolean>,
  removeFile: () => Promise<void>,
): Promise<boolean> {
  let registered: boolean;
  try {
    registered = await lookupRegistration();
  } catch {
    return false;
  }
  if (registered) return false;
  try {
    await removeFile();
    return true;
  } catch {
    return false;
  }
}

import { logger } from "../../config/logger.js";
import { localFileStorage } from "./local-file.storage.js";

export const removeAttachmentFiles = async (storageKeys: string[]) => {
  const results = await Promise.allSettled(
    storageKeys.map((storageKey) => localFileStorage.remove(storageKey)),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn(
        { err: result.reason, storageKey: storageKeys[index] },
        "Attachment cleanup failed",
      );
    }
  });
};

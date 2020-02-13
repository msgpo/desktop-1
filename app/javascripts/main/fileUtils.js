import yauzl from "yauzl";
const fs = require("fs");
const path = require("path");

export const FILE_DOES_NOT_EXIST = "ENOENT";
export const FILE_ALREADY_EXISTS = "EEXIST";

export async function readJSONFile(path) {
  const data = await fs.promises.readFile(path, "utf8");
  return JSON.parse(data);
}

export async function writeJSONFile(filepath, data) {
  await ensureDirectoryExists(path.dirname(filepath));
  await fs.promises.writeFile(filepath, JSON.stringify(data, null, 2), "utf8");
}

export async function ensureDirectoryExists(dirPath) {
  try {
    const stat = await fs.promises.lstat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(
        "Tried to create a directory where a file of the same " +
          `name already exists: ${dirPath}`
      );
    }
  } catch (error) {
    if (error.code === FILE_DOES_NOT_EXIST) {
      // No directory here. Make sure there is a *parent* directory, and then
      // create it.
      await ensureDirectoryExists(path.dirname(dirPath));
      await fs.promises.mkdir(dirPath);
    } else {
      throw error;
    }
  }
}

/**
 * Deletes a directory (handling recursion.)
 * @param {string} dirPath the path of the directory
 */
export async function deleteDir(dirPath) {
  try {
    await deleteDirContents(dirPath);
  } catch (error) {
    if (error.code === FILE_DOES_NOT_EXIST) {
      // Directory has already been deleted.
      return;
    }
    throw error;
  }
  await fs.promises.rmdir(dirPath);
}

export async function deleteDirContents(dirPath) {
  const children = await fs.promises.readdir(dirPath, {
    withFileTypes: true
  });
  for (const child of children) {
    const childPath = path.join(dirPath, child.name);
    if (child.isDirectory()) {
      await deleteDirContents(childPath);
      await fs.promises.rmdir(childPath);
    } else {
      await fs.promises.unlink(childPath);
    }
  }
}

export async function extractNestedZip(source, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      source,
      { lazyEntries: true, autoClose: true },
      (err, zipFile) => {
        let cancelled = false;
        const tryReject = err => {
          if (!cancelled) {
            cancelled = true;
            reject(err);
          }
        };
        if (err) return tryReject(err);

        zipFile.readEntry();
        zipFile.on("close", resolve);
        zipFile.on("entry", entry => {
          if (cancelled) return;
          if (entry.fileName.endsWith("/")) {
            // entry is a directory, skip and read next entry
            zipFile.readEntry();
            return;
          }

          zipFile.openReadStream(entry, async (err, stream) => {
            if (cancelled) return;
            if (err) return tryReject(err);
            stream.on("error", tryReject);
            const filepath = path.join(
              dest,
              // Remove the first element of the entry's path, which is the base
              // directory we want to ignore
              entry.fileName.substring(entry.fileName.indexOf("/") + 1)
            );
            try {
              await ensureDirectoryExists(path.dirname(filepath));
            } catch (error) {
              return tryReject(error);
            }
            const writeStream = fs
              .createWriteStream(filepath)
              .on("error", tryReject)
              .on("error", tryReject);

            stream.pipe(writeStream).on("close", () => {
              zipFile.readEntry(); // Reads next entry.
            });
          });
        });
      }
    );
  });
}

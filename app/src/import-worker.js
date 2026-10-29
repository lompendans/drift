"use strict";
// Runs one import step off the main thread (see main-library.js).
const { parentPort, workerData } = require("worker_threads");
const imp = require("./import");

try {
  const { op, arg } = workerData;
  let result;
  if (op === "find") result = imp.find();
  else if (op === "count") { imp.count(arg); result = { history: arg.history, bookmarks: arg.bookmarks }; }
  else if (op === "read") result = { pages: arg.history ? imp.readHistory(arg.source) : [], marks: arg.bookmarks ? imp.readBookmarks(arg.source) : [] };
  parentPort.postMessage({ result });
} catch (e) {
  parentPort.postMessage({ error: e.message });
}

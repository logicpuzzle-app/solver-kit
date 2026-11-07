export function createWorker(scriptUrl) {
  const url = new URL(scriptUrl);
  if (url.origin === location.origin) return new Worker(url, { type: "module" });

  const objectUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: "text/javascript" }));
  let worker;
  try {
    worker = new Worker(objectUrl, { type: "module" });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  // Module fetching is asynchronous; retain the URL until loading is observed or the worker ends.
  const release = () => {
    URL.revokeObjectURL(objectUrl);
    worker.removeEventListener("message", release);
    worker.removeEventListener("error", release);
    worker.removeEventListener("messageerror", release);
  };
  worker.addEventListener("message", release);
  worker.addEventListener("error", release);
  worker.addEventListener("messageerror", release);
  const terminate = worker.terminate.bind(worker);
  worker.terminate = () => { release(); terminate(); };
  return worker;
}

(() => {
  const node = document.querySelector("#pause-state");
  if (!node || window.__edgeclosePauseTextPatched) return;
  const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
  if (!descriptor?.set || !descriptor?.get) return;
  let value = descriptor.get.call(node);
  Object.defineProperty(node, "textContent", {
    configurable: true,
    get() { return value; },
    set(next) {
      const normalized = String(next ?? "");
      if (normalized === value) return;
      value = normalized;
      descriptor.set.call(this, normalized);
    }
  });
  window.__edgeclosePauseTextPatched = true;
})();

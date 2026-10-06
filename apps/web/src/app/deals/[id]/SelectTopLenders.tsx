"use client";

/** Ticks the top N recommended lenders (eligible, not yet sent, best fit first). */
export function SelectTopLenders({ n = 5 }: { n?: number }) {
  const pick = (count: number) => {
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[name="funderIds"]')];
    boxes.forEach((b) => (b.checked = false));
    boxes
      .filter((b) => b.dataset.recommended === "1")
      .slice(0, count)
      .forEach((b) => (b.checked = true));
  };
  return (
    <p className="row small">
      <button type="button" onClick={() => pick(n)}>
        Tick top {n} recommended
      </button>
      <button type="button" onClick={() => pick(0)}>
        Clear
      </button>
      <span className="muted">
        Sorted by fit: appetite rules, then each lender&apos;s approvals on Ascend files.
      </span>
    </p>
  );
}

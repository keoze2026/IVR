/**
 * Tables become cards on a phone.
 *
 * A row of eight columns cannot be read on a narrow screen without scrolling
 * sideways. This copies each column's heading onto its cells, so the
 * stylesheet can stack a row into a card with every figure still named.
 */

import { useEffect, type RefObject } from "react";

function label(root: HTMLElement) {
  for (const table of root.querySelectorAll<HTMLTableElement>("table.table")) {
    const headings = Array.from(table.querySelectorAll("thead th"), (th) =>
      // A heading only screen readers see ("Actions") names no figure.
      th.querySelector(".sr-only") ? "" : (th.textContent ?? "").trim(),
    );
    if (headings.length === 0) continue;
    table.dataset.cards = "";
    for (const row of table.querySelectorAll("tbody tr")) {
      Array.from(row.children).forEach((cell, i) => {
        const heading = (cell as HTMLTableCellElement).colSpan > 1 ? "" : (headings[i] ?? "");
        if (cell.getAttribute("data-label") !== heading) cell.setAttribute("data-label", heading);
        // A figure that is not there is left off the card.
        cell.toggleAttribute("data-empty", i > 0 && cell.textContent?.trim() === "—");
      });
    }
  }
}

export function useCardTables(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    label(root);
    // Rows arrive and change as data loads. Only structure is watched, so
    // setting the labels does not set this off again.
    const observer = new MutationObserver(() => label(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [ref]);
}

import { Platform } from 'react-native';

const ROOT_ID = 'ek-print-root';
const STYLE_ID = 'ek-print-style';

/** Print rules: the receipt box is invisible on screen; when printing, everything else on the page
 * is hidden and only the receipt (about 58mm wide, monospace) prints. */
const PRINT_CSS = `
#${ROOT_ID}{display:none}
@media print{
  @page{size:58mm auto;margin:2mm}
  body > *:not(#${ROOT_ID}){display:none !important}
  #${ROOT_ID}{display:block !important;width:54mm;margin:0;padding:0;color:#000;background:#fff;
    font-family:'Courier New',Courier,monospace;font-size:11px;line-height:1.35;white-space:pre}
}`;

/** Fills a print-only receipt box with `lines` and opens the browser's print dialog (which also
 * offers Save as PDF). Web only; returns false anywhere else. No printer integration. */
export function printReceipt(lines: string[]): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
  }
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  root.textContent = lines.join('\n');
  window.print();
  return true;
}

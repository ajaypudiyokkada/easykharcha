import { Platform } from 'react-native';

type PickOptions = {
  accept: string;
  multiple?: boolean;
  /** `capture="environment"` opens the rear camera directly on a phone browser instead of the
   * gallery picker — the exact mechanism this step's spec calls for. */
  capture?: 'environment';
};

/** A raw hidden `<input type="file">`, triggered from a user gesture — web only (this flow's
 * source screen is a PWA feature; native camera/gallery access is out of scope for this step). */
export function pickFiles(options: PickOptions): Promise<File[]> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.accept;
    input.multiple = Boolean(options.multiple);
    if (options.capture) input.setAttribute('capture', options.capture);
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files ? Array.from(input.files) : []);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

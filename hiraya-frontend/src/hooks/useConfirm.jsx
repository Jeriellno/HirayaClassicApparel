import { useCallback, useRef, useState } from 'react';
import Modal from '../components/common/Modal';

/**
 * useConfirm — the in-app replacement for `window.confirm()`.
 *
 * The browser's own confirm box ("localhost:5173 says…") looks like a system
 * error, cannot be styled, BLOCKS the page while open, and some browsers stop
 * showing it after repeated dialogs — which would silently skip the question.
 * This renders the shared `Modal` instead, with Confirm / Cancel buttons.
 *
 * Usage keeps the old one-line shape, just awaited:
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm({ title: 'Delete product?', message: '…', danger: true }))) return;
 *   …
 *   return (<>…{confirmDialog}</>);
 *
 * Cancel, the ✕, the backdrop and Escape all resolve `false`.
 *
 * @returns {[ (options: { title?: string, message?: string, confirmText?: string,
 *              cancelText?: string, danger?: boolean }) => Promise<boolean>, JSX.Element ]}
 */
export default function useConfirm() {
  const [options, setOptions] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback(
    (opts = {}) =>
      new Promise((resolve) => {
        // A second request while one is open cancels the first, never leaks it.
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setOptions(opts);
      }),
    []
  );

  const settle = useCallback((result) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const dialog = (
    <Modal
      isOpen={Boolean(options)}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={options?.title ?? 'Are you sure?'}
      message={options?.message ?? ''}
      confirmText={options?.confirmText ?? 'Confirm'}
      cancelText={options?.cancelText ?? 'Cancel'}
      isDanger={Boolean(options?.danger)}
    />
  );

  return [confirm, dialog];
}

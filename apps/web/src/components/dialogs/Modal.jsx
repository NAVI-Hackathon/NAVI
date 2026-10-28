import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import Icon from '../Icon.jsx';
import { duration, ease, transition } from '../../motion/tokens.js';

const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]';

/** Accessible modal: focus trap, Escape, focus restore. Wrap in <AnimatePresence> for exit motion. */
export default function Modal({ title, onClose, children, size = 'md', labelledBy = 'modal-title' }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement;
    // A field marked data-autofocus (e.g. the search box) takes the focus; otherwise the first control.
    const first = panel.current?.querySelector('[data-autofocus]') ?? panel.current?.querySelector(FOCUSABLE);
    (first ?? panel.current)?.focus();
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('has-modal');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-modal');
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function trap(e) {
    if (e.key !== 'Tab') return;
    const items = Array.from(panel.current.querySelectorAll(FOCUSABLE)).filter(el => el.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <motion.div className="modal-layer" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: transition.normal }} exit={{ opacity: 0, transition: transition.exit }}>
      <div className="modal-scrim" onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={panel} className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={trap}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: duration.normal, ease: ease.enter } }}
        exit={{ opacity: 0, y: 8, scale: 0.985, transition: transition.exit }}
      >
        <header className="modal-header">
          <h2 id={labelledBy}>{title}</h2>
          <button type="button" className="icon-button" aria-label="關閉" onClick={onClose}><Icon name="close" size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>
  );
}

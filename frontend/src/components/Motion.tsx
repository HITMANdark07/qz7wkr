import { useLayoutEffect, useRef, useState } from "react";

/** Number pop-in (transitions.dev #02): changed characters re-enter with blur; shared leading ones stay still. */
export function PopNumber({ value }: { value: string }) {
  const prev = useRef(value);
  const [run, setRun] = useState(0);
  const [same, setSame] = useState(value.length);
  useLayoutEffect(() => {
    if (prev.current === value) return;
    let n = 0;
    while (n < prev.current.length && n < value.length && prev.current[n] === value[n]) n++;
    setSame(n);
    setRun((r) => r + 1);
    prev.current = value;
  }, [value]);
  const chars = value.split("");
  return (
    // Remounting via key replays the animation, like toggling .is-animating after a reflow.
    <span key={run} className={`t-digit-group${run ? " is-animating" : ""}`} aria-label={value}>
      {chars.map((ch, i) => (
        <span key={i} aria-hidden="true" className="t-digit"
          data-same={i < same ? "" : undefined}
          data-stagger={i === chars.length - 2 ? "1" : i === chars.length - 1 ? "2" : undefined}>
          {ch === " " ? "\u00a0" : ch}
        </span>
      ))}
    </span>
  );
}

/** Sliding segmented control (transitions.dev #16): one pill tweens between measured tab positions. */
export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  const move = (animate: boolean) => {
    const tab = bar.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    const p = pill.current;
    if (!tab || !p) return;
    if (!animate) p.style.transition = "none";
    p.style.transform = `translateX(${tab.offsetLeft}px)`;
    p.style.width = `${tab.offsetWidth}px`;
    if (!animate) { void p.offsetWidth; p.style.transition = ""; }
  };

  // Value change: slide (except the very first placement).
  useLayoutEffect(() => {
    move(!first.current);
    first.current = false;
  }, [value]);

  // Snap (no animation) only when layout changes underneath: web font load and resize.
  // Keeping this out of the value effect matters: fonts.ready is already resolved, so a
  // snap queued on every change would cancel the slide the moment it starts.
  useLayoutEffect(() => {
    const snap = () => move(false);
    document.fonts?.ready.then(snap);
    window.addEventListener("resize", snap);
    return () => window.removeEventListener("resize", snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={bar} className="t-tabs" role="tablist" aria-label={label}>
      <span ref={pill} className="t-tabs-pill" aria-hidden="true" />
      {options.map((o) => (
        <button key={String(o.value)} role="tab" className="t-tab" aria-selected={o.value === value}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
